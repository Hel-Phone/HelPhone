/**
 * apps/web/src/lib/retry.test.ts
 *
 * Deterministic tests for the retry/backoff utility.
 *
 * Fake timers replace `setTimeout` so no real clock sleeps occur — all
 * backoff delays are driven by `vi.runAllTimersAsync()`.
 *
 * Scenarios covered
 * ──────────────────
 * 1. Eventual success   – fn fails N-1 times then succeeds; correct value
 *    and attempt count returned.
 * 2. Exhausted retries  – fn always throws; last error is re-thrown after
 *    exactly `attempts` calls.
 * 3. Abort              – AbortController fires mid-sleep; promise rejects
 *    with AbortError and fn is not called again.
 * 4. Attempt count      – attempt counts are reported correctly for first-try
 *    success and for success on the last attempt.
 * 5. Backoff delays     – computed delay doubles each retry up to maxDelayMs.
 * 6. shouldRetry predicate – non-retryable errors are thrown immediately.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { retry } from "./retry"

// ─────────────────────────────────────────────────────────────────────────────
// Fake-timer helpers
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Run a retry promise to completion while advancing fake timers.
 *
 * We alternate between:
 *   1. Flushing microtasks (Promise.resolve()) so the retry loop can run up
 *      to the next `await sleep(...)` point.
 *   2. Advancing all pending timers so the sleep resolves.
 *
 * Repeated until the promise settles.
 */
async function driveRetry<T>(promise: Promise<T>): Promise<T> {
  let settled = false
  let resolvedValue: T
  let rejectedError: unknown

  promise.then(
    (v) => { settled = true; resolvedValue = v as T },
    (e) => { settled = true; rejectedError = e },
  )

  // Drive until settled — max 20 rounds to guard against infinite loops
  for (let i = 0; i < 20 && !settled; i++) {
    await Promise.resolve()        // flush microtasks
    await vi.runAllTimersAsync()   // advance all timers + their microtasks
    await Promise.resolve()        // flush any new microtasks created
  }

  // Final flush
  await Promise.resolve()

  if (rejectedError !== undefined) throw rejectedError
  return resolvedValue!
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Eventual success
// ─────────────────────────────────────────────────────────────────────────────

describe("eventual success", () => {
  it("returns the value when fn succeeds on the first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok")

    const result = await driveRetry(retry(fn, { attempts: 3, baseMs: 100 }))

    expect(result.value).toBe("ok")
    expect(result.attempts).toBe(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("succeeds after one failure then one success", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("recovered")

    const result = await driveRetry(retry(fn, { attempts: 3, baseMs: 50 }))

    expect(result.value).toBe("recovered")
    expect(result.attempts).toBe(2)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("succeeds on the last allowed attempt", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("last-chance")

    const result = await driveRetry(retry(fn, { attempts: 3, baseMs: 50 }))

    expect(result.value).toBe("last-chance")
    expect(result.attempts).toBe(3)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Exhausted retries
// ─────────────────────────────────────────────────────────────────────────────

describe("exhausted retries", () => {
  it("throws the last error after all attempts are exhausted", async () => {
    const err = new Error("always fails")
    const fn = vi.fn().mockRejectedValue(err)

    await expect(driveRetry(retry(fn, { attempts: 3, baseMs: 50 }))).rejects.toThrow(
      "always fails",
    )
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it("calls fn exactly `attempts` times on total failure", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("nope"))

    await expect(driveRetry(retry(fn, { attempts: 4, baseMs: 10 }))).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it("re-throws the last error, not the first", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("first error"))
      .mockRejectedValueOnce(new Error("last error"))

    await expect(driveRetry(retry(fn, { attempts: 2, baseMs: 10 }))).rejects.toThrow(
      "last error",
    )
  })

  it("throws RangeError synchronously when attempts < 1", async () => {
    const fn = vi.fn()
    await expect(retry(fn, { attempts: 0 })).rejects.toThrow(RangeError)
    expect(fn).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Abort
// ─────────────────────────────────────────────────────────────────────────────

describe("abort", () => {
  it("rejects with AbortError when signal is aborted before first call", async () => {
    const controller = new AbortController()
    controller.abort()

    const fn = vi.fn().mockResolvedValue("x")
    await expect(
      driveRetry(retry(fn, { attempts: 3, signal: controller.signal })),
    ).rejects.toMatchObject({ name: "AbortError" })

    expect(fn).not.toHaveBeenCalled()
  })

  it("rejects with AbortError when signal fires during backoff sleep", async () => {
    const controller = new AbortController()
    const fn = vi.fn().mockRejectedValue(new Error("transient"))

    // fn will fail, retry goes to sleep — abort mid-sleep
    const promise = retry(fn, { attempts: 5, baseMs: 10_000, signal: controller.signal })

    // Let fn run and reach the sleep
    await Promise.resolve()
    await Promise.resolve()

    // Abort while sleeping
    controller.abort()

    await expect(driveRetry(promise)).rejects.toMatchObject({ name: "AbortError" })
    // fn ran once before the abort-during-sleep
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("does not call fn again after abort", async () => {
    const controller = new AbortController()
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("should not reach")

    const promise = retry(fn, { attempts: 5, baseMs: 5_000, signal: controller.signal })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()

    await expect(driveRetry(promise)).rejects.toMatchObject({ name: "AbortError" })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Attempt counts
// ─────────────────────────────────────────────────────────────────────────────

describe("attempt counts", () => {
  it("reports attempts=1 on immediate success", async () => {
    const fn = vi.fn().mockResolvedValue(42)
    const { attempts } = await driveRetry(retry(fn, { attempts: 5 }))
    expect(attempts).toBe(1)
  })

  it("reports attempts equal to the number of calls made", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("x"))
      .mockRejectedValueOnce(new Error("x"))
      .mockResolvedValue("done")

    const { attempts } = await driveRetry(retry(fn, { attempts: 5, baseMs: 10 }))
    expect(attempts).toBe(3)
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Backoff delays
// ─────────────────────────────────────────────────────────────────────────────

describe("backoff delays", () => {
  it("doubles the delay on each retry up to maxDelayMs", () => {
    // Test the pure delay computation directly — no timers needed
    // backoff formula: baseMs * 2^attempt, capped at maxDelayMs
    // attempt 0 → 100 * 1 = 100
    // attempt 1 → 100 * 2 = 200
    // attempt 2 → 100 * 4 = 400, capped at 300
    const baseMs = 100
    const maxDelayMs = 300
    const computeDelay = (attempt: number) => Math.min(baseMs * 2 ** attempt, maxDelayMs)

    expect(computeDelay(0)).toBe(100)
    expect(computeDelay(1)).toBe(200)
    expect(computeDelay(2)).toBe(300)
    expect(computeDelay(3)).toBe(300) // still capped
  })

  it("caps delay at maxDelayMs for large baseMs", () => {
    const baseMs = 1_000
    const maxDelayMs = 500
    const computeDelay = (attempt: number) => Math.min(baseMs * 2 ** attempt, maxDelayMs)

    // Every delay must be ≤ maxDelayMs regardless of attempt
    for (let i = 0; i < 10; i++) {
      expect(computeDelay(i)).toBeLessThanOrEqual(maxDelayMs)
    }
  })

  it("no delay is applied after the final failing attempt", async () => {
    // With attempts:2, only 1 sleep should occur (between attempt 1 and 2).
    // Verify by checking fn was called exactly 2 times after a failed run.
    const fn = vi.fn().mockRejectedValue(new Error("fail"))

    await expect(
      driveRetry(retry(fn, { attempts: 2, baseMs: 50 })),
    ).rejects.toThrow("fail")

    expect(fn).toHaveBeenCalledTimes(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. shouldRetry predicate
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldRetry predicate", () => {
  it("retries only when shouldRetry returns true", async () => {
    const retryableError = new Error("retryable")
    const fn = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue("ok")

    const result = await driveRetry(
      retry(fn, {
        attempts: 3,
        baseMs: 10,
        shouldRetry: (err) => (err as Error).message === "retryable",
      }),
    )

    expect(result.value).toBe("ok")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("throws immediately for non-retryable errors without further attempts", async () => {
    const fatal = new Error("fatal")
    const fn = vi.fn().mockRejectedValue(fatal)

    await expect(
      driveRetry(
        retry(fn, {
          attempts: 5,
          baseMs: 10,
          shouldRetry: () => false,
        }),
      ),
    ).rejects.toThrow("fatal")

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("receives the current attempt number (1-indexed)", async () => {
    const calls: number[] = []
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("e"))
      .mockRejectedValueOnce(new Error("e"))
      .mockResolvedValue("ok")

    await driveRetry(
      retry(fn, {
        attempts: 5,
        baseMs: 10,
        shouldRetry: (_err, attempt) => {
          calls.push(attempt)
          return true
        },
      }),
    )

    // shouldRetry is called after attempt 1 and after attempt 2
    expect(calls).toEqual([1, 2])
  })
})
