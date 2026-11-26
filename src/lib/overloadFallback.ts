/**
 * Bounded polling fallback for HTTP 503 Overloaded (ADR-020).
 *
 * When dispatch or a federation peer reports overload, the client stops
 * streaming the WebSocket firehose and polls a small, bounded read endpoint at
 * a configurable interval. Polling is read-only: it never resubmits a request,
 * which is what makes the eventual reconnect duplicate-free.
 */

export type DispatchTransportMode = 'websocket' | 'polling'

export interface OverloadState {
  mode: DispatchTransportMode
  degraded: boolean
  retryAfterMs: number
  pollIntervalMs: number
  polls: number
  lastPolledAt: number | null
  recoveredAt: number | null
}

export interface OverloadFallbackOptions {
  pollUrl?: string
  pollIntervalMs?: number
  fetchImpl?: typeof fetch
  now?: () => number
  setTimeoutImpl?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutImpl?: (handle: ReturnType<typeof setTimeout>) => void
  onModeChange?: (mode: DispatchTransportMode, state: OverloadState) => void
  onDegradedChange?: (degraded: boolean, state: OverloadState) => void
  onMessages?: (messages: unknown[]) => void
}

/** Recognise an overload signal on either the HTTP or WebSocket surface. */
export function isOverloadSignal(signal: unknown): boolean {
  if (!signal || typeof signal !== 'object') return false
  const record = signal as Record<string, unknown>
  if (typeof (signal as { status?: number }).status === 'number') {
    const response = signal as { status: number; headers?: { get?: (name: string) => string | null } }
    if (response.status === 503) return true
    const header = response.headers?.get?.('X-Overloaded')
    if (header === '1' || header === 'true') return true
  }
  return (
    record.error === 'Overloaded' ||
    record.code === 'overloaded' ||
    record.type === 'overloaded' ||
    record.type === 'DISPATCH_OVERLOADED'
  )
}

/** Read the Retry-After hint from a response or protocol message (ms). */
export function retryAfterMsOf(signal: unknown, fallbackMs: number): number {
  if (!signal || typeof signal !== 'object') return fallbackMs
  const response = signal as {
    headers?: { get?: (name: string) => string | null }
    retryAfterSeconds?: number
    retryAfterMs?: number
  }
  const header = response.headers?.get?.('Retry-After')
  const fromHeader = header ? Number(header) * 1000 : NaN
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.min(fromHeader, fallbackMs)
  if (typeof response.retryAfterMs === 'number' && response.retryAfterMs > 0) {
    return Math.min(response.retryAfterMs, fallbackMs)
  }
  if (typeof response.retryAfterSeconds === 'number' && response.retryAfterSeconds > 0) {
    return Math.min(response.retryAfterSeconds * 1000, fallbackMs)
  }
  return fallbackMs
}

export class OverloadFallback {
  private readonly pollUrl: string
  private readonly pollIntervalMs: number
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly setTimeoutImpl: NonNullable<OverloadFallbackOptions['setTimeoutImpl']>
  private readonly clearTimeoutImpl: NonNullable<OverloadFallbackOptions['clearTimeoutImpl']>
  private readonly seen = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private state: OverloadState

  constructor(private options: OverloadFallbackOptions = {}) {
    this.pollUrl = options.pollUrl ?? '/api/dispatch/open-today'
    this.pollIntervalMs = Math.max(250, options.pollIntervalMs ?? 5_000)
    this.fetchImpl =
      options.fetchImpl ??
      ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => fetch(input, init))
    this.now = options.now ?? (() => Date.now())
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle))
    this.state = {
      mode: 'websocket',
      degraded: false,
      retryAfterMs: this.pollIntervalMs,
      pollIntervalMs: this.pollIntervalMs,
      polls: 0,
      lastPolledAt: null,
      recoveredAt: null,
    }
  }

  getState(): OverloadState {
    return { ...this.state }
  }

  /** Enter degraded mode and start polling within one retry interval. */
  enterOverload(signal?: unknown): OverloadState {
    const retryAfterMs = signal === undefined ? this.pollIntervalMs : retryAfterMsOf(signal, this.pollIntervalMs)
    this.state = {
      ...this.state,
      mode: 'polling',
      degraded: true,
      retryAfterMs,
      recoveredAt: null,
    }
    this.notify()
    this.schedule(Math.min(retryAfterMs, this.pollIntervalMs))
    return this.getState()
  }

  /** Adaptive: call on every fetch response; returns true when it was overload. */
  observeResponse(signal: unknown): boolean {
    if (!isOverloadSignal(signal)) return false
    this.enterOverload(signal)
    return true
  }

  private schedule(delayMs: number): void {
    this.cancel()
    this.timer = this.setTimeoutImpl(() => {
      this.timer = null
      if (this.state.degraded) void this.pollOnce()
    }, Math.max(0, delayMs))
  }

  private cancel(): void {
    if (this.timer !== null) {
      this.clearTimeoutImpl(this.timer)
      this.timer = null
    }
  }

  /**
   * One bounded read poll. Responses are deduplicated by id/idempotencyKey so
   * a reconnect cannot replay the same event twice to the UI.
   */
  async pollOnce(): Promise<{ ok: boolean; delivered: number }> {
    this.state = { ...this.state, polls: this.state.polls + 1, lastPolledAt: this.now() }
    let ok = false
    let delivered = 0
    try {
      const response = await this.fetchImpl(this.pollUrl, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      ok = response.ok
      if (this.observeResponse(response)) return { ok: false, delivered: 0 }

      if (response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        const items = Array.isArray(body)
          ? body
          : body && typeof body === 'object' && Array.isArray((body as { incidents?: unknown[] }).incidents)
            ? (body as { incidents: unknown[] }).incidents
            : []
        const fresh = items.filter((item) => {
          const record = item as Record<string, unknown>
          const key = String(record.id ?? record.idempotencyKey ?? record.nonce ?? '')
          if (!key || this.seen.has(key)) return false
          this.seen.add(key)
          return true
        })
        delivered = fresh.length
        if (delivered > 0) this.options.onMessages?.(fresh)
      }
    } catch {
      ok = false
    } finally {
      if (this.state.degraded) this.schedule(this.pollIntervalMs)
    }
    return { ok, delivered }
  }

  /** Leave degraded mode. No queued writes are replayed here — that is idempotent by design. */
  recover(): void {
    this.cancel()
    if (!this.state.degraded && this.state.mode === 'websocket') return
    this.state = {
      ...this.state,
      mode: 'websocket',
      degraded: false,
      retryAfterMs: this.pollIntervalMs,
      recoveredAt: this.now(),
    }
    this.notify()
  }

  dispose(): void {
    this.cancel()
    this.state = { ...this.state, degraded: false, mode: 'websocket' }
  }

  private notify(): void {
    this.options.onModeChange?.(this.state.mode, this.getState())
    this.options.onDegradedChange?.(this.state.degraded, this.getState())
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent('helphone:dispatch-degraded', {
          detail: this.getState(),
        }),
      )
    }
  }
}
