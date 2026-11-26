// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { OverloadFallback, isOverloadSignal, retryAfterMsOf } from '../src/lib/overloadFallback.js'
import { WsClient } from '../src/lib/wsClient.js'
import DispatchDegradedBanner from '../src/components/DispatchDegradedBanner'

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
  }
}

function timerHarness() {
  const timers = []
  const cleared = []
  return {
    timers,
    cleared,
    setTimeoutImpl: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeoutImpl: (handle) => cleared.push(handle),
  }
}

class FakeWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.sent = []
    FakeWebSocket.instances.push(this)
  }
  send(data) {
    this.sent.push(data)
  }
  close() {
    this.onclose?.()
  }
}

describe('ADR-020 client — bounded polling on 503 Overloaded', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('recognises overload signals and clamps Retry-After to the poll ceiling', () => {
    expect(isOverloadSignal({ status: 503 })).toBe(true)
    expect(isOverloadSignal({ code: 'overloaded' })).toBe(true)
    expect(isOverloadSignal({ type: 'DISPATCH_OVERLOADED' })).toBe(true)
    expect(isOverloadSignal({ status: 200 })).toBe(false)
    const signal = { headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '30' : null) } }
    expect(retryAfterMsOf(signal, 5_000)).toBe(5_000)
  })

  it('enters polling within one retry interval and deduplicates polled messages', async () => {
    const harness = timerHarness()
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: 'a' }, { id: 'b' }]))
    const fallback = new OverloadFallback({
      pollIntervalMs: 5_000,
      fetchImpl,
      ...harness,
    })

    fallback.enterOverload({ status: 503, headers: { get: () => '2' } })
    expect(fallback.getState().degraded).toBe(true)
    expect(fallback.getState().mode).toBe('polling')
    expect(harness.timers).toHaveLength(1)
    expect(harness.timers[0].ms).toBeLessThanOrEqual(5_000)

    const first = await fallback.pollOnce()
    expect(first.delivered).toBe(2)
    const second = await fallback.pollOnce()
    expect(second.delivered).toBe(0)
    expect(fallback.getState().polls).toBe(2)

    fallback.recover()
    expect(fallback.getState().degraded).toBe(false)
    expect(fallback.getState().mode).toBe('websocket')
  })

  it('defers writes while degraded and flushes each exactly once on reconnect', () => {
    const harness = timerHarness()
    const fallback = new OverloadFallback({
      pollIntervalMs: 5_000,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse([])),
      ...harness,
    })
    const states = []
    const degradedChanges = []
    const client = new WsClient({
      url: 'ws://localhost/ws',
      overloadFallback: fallback,
      onStateChange: (state) => states.push(state),
      onDegradedChange: (degraded) => degradedChanges.push(degraded),
    })

    client.connect()
    FakeWebSocket.instances[0].onopen()
    expect(client.getState()).toBe('OPEN')

    client.handleInboundMessage({ type: 'overloaded', error: 'Overloaded', code: 'overloaded' })
    expect(client.getDegraded()).toBe(true)
    expect(client.getState()).toBe('DEGRADED')
    expect(fallback.getState().mode).toBe('polling')

    const first = client.sendDispatch({ idempotencyKey: 'req-1', type: 'RqCreated' }, { payload: 'P0' })
    const duplicate = client.sendDispatch({ idempotencyKey: 'req-1', type: 'RqCreated' }, { payload: 'P0' })
    expect(first.deferred).toBe(true)
    expect(duplicate.deferred).toBe(true)
    expect(FakeWebSocket.instances[0].sent).toHaveLength(0)

    // Reconnect: the deferred write is sent exactly once, no duplicate submission.
    client.connect()
    FakeWebSocket.instances[1].onopen()
    expect(client.getDegraded()).toBe(false)
    expect(client.getState()).toBe('OPEN')
    expect(FakeWebSocket.instances[1].sent).toHaveLength(1)
    expect(JSON.parse(FakeWebSocket.instances[1].sent[0]).idempotencyKey).toBe('req-1')
    expect(states).toContain('DEGRADED')
    expect(degradedChanges).toEqual([true, false])
    client.close()
  })

  it('renders a visible degraded banner and clears it on recovery', () => {
    render(<DispatchDegradedBanner />)
    expect(screen.queryByTestId('dispatch-degraded-banner')).toBeNull()

    act(() => {
      window.dispatchEvent(
        new CustomEvent('helphone:dispatch-degraded', {
          detail: { degraded: true, retryAfterMs: 2_000 },
        }),
      )
    })
    const banner = screen.getByTestId('dispatch-degraded-banner')
    expect(banner.textContent).toContain('polling mode')
    expect(banner.textContent).toContain('2s')

    act(() => {
      window.dispatchEvent(
        new CustomEvent('helphone:dispatch-degraded', { detail: { degraded: false } }),
      )
    })
    expect(screen.queryByTestId('dispatch-degraded-banner')).toBeNull()
  })
})
