/**
 * apps/web/src/lib/retry.ts
 *
 * Generic retry with exponential backoff.
 *
 * Delays are implemented via `setTimeout` so they are fully controllable by
 * `vi.useFakeTimers()` in tests — no real clock sleeps occur.
 *
 * Backoff formula:  delay = baseMs * 2^attempt   (capped at maxDelayMs)
 *
 * @example
 * const result = await retry(() => fetchData(), { attempts: 3, baseMs: 200 })
 *
 * @example  abort early
 * const controller = new AbortController()
 * const p = retry(fetchData, { attempts: 5, signal: controller.signal })
 * controller.abort()
 * await p  // rejects with AbortError
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type RetryOptions = {
  /**
   * Maximum number of attempts (including the first call).
   * Must be ≥ 1.  Default: 3.
   */
  attempts?: number
  /**
   * Base delay in milliseconds for the first retry.
   * Subsequent retries double this value.  Default: 100.
   */
  baseMs?: number
  /**
   * Upper bound on the computed delay.  Default: 30_000 (30 s).
   */
  maxDelayMs?: number
  /**
   * Optional `AbortSignal`.  When aborted the current sleep is cut short
   * and the returned promise rejects with an `AbortError`.
   */
  signal?: AbortSignal
  /**
   * Optional predicate.  When provided, only errors that satisfy this
   * function are retried; others are rethrown immediately.
   * Default: retry on every error.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean
}

export type RetryResult<T> = {
  value: T
  /** Total number of attempts made (1 = succeeded on first try). */
  attempts: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns a promise that resolves after `ms` milliseconds, or rejects early
 *  when the given `AbortSignal` fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const id = setTimeout(resolve, ms)

    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(id)
        reject(createAbortError())
      },
      { once: true },
    )
  })
}

function createAbortError(): DOMException {
  return new DOMException("Retry aborted", "AbortError")
}

function computeDelay(baseMs: number, maxDelayMs: number, attempt: number): number {
  // attempt is 0-indexed: first retry is attempt 0, second is 1, …
  const raw = baseMs * 2 ** attempt
  return Math.min(raw, maxDelayMs)
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute `fn` up to `attempts` times, waiting an exponentially increasing
 * delay between each attempt.
 *
 * Resolves with `{ value, attempts }` on success.
 * Rejects with the last error when all attempts are exhausted.
 * Rejects immediately with an `AbortError` when the signal fires.
 */
export async function retry<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions = {},
): Promise<RetryResult<T>> {
  const maxAttempts = options.attempts ?? 3
  const baseMs = options.baseMs ?? 100
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const signal = options.signal
  const shouldRetry = options.shouldRetry ?? (() => true)

  if (maxAttempts < 1) {
    throw new RangeError(`retry: attempts must be ≥ 1, got ${maxAttempts}`)
  }

  let lastError: unknown

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) {
      throw createAbortError()
    }

    try {
      const value = await fn()
      return { value, attempts: attempt + 1 }
    } catch (error) {
      lastError = error

      // Don't retry if the caller says not to
      if (!shouldRetry(error, attempt + 1)) {
        throw error
      }

      // No delay after the final attempt — just fall through to throw
      if (attempt < maxAttempts - 1) {
        const delay = computeDelay(baseMs, maxDelayMs, attempt)
        await sleep(delay, signal)
      }
    }
  }

  throw lastError
}
