import React, { useEffect, useState } from 'react'
import { colors } from '../theme/tokens'

export interface DispatchDegradedDetail {
  degraded: boolean
  mode?: string
  retryAfterMs?: number
}

/**
 * Visible degraded-state indicator for ADR-020 overload. Appears when either
 * the WebSocket client enters bounded-polling mode or the service worker sees
 * a 503 Overloaded from the dispatch API.
 */
export function DispatchDegradedBanner() {
  const [degraded, setDegraded] = useState(false)
  const [retryAfterMs, setRetryAfterMs] = useState(5_000)

  useEffect(() => {
    const onClientEvent = (event: Event) => {
      const detail = (event as CustomEvent<DispatchDegradedDetail>).detail
      const next = Boolean(detail?.degraded)
      setDegraded(next)
      if (typeof detail?.retryAfterMs === 'number') setRetryAfterMs(detail.retryAfterMs)
    }
    const onSwMessage = (event: MessageEvent) => {
      const data = event.data as Record<string, unknown> | undefined
      if (data?.type === 'DISPATCH_OVERLOADED') {
        setDegraded(true)
        if (typeof data.retryAfterMs === 'number') setRetryAfterMs(data.retryAfterMs as number)
      } else if (data?.type === 'DISPATCH_RECOVERED') {
        setDegraded(false)
      }
    }

    window.addEventListener('helphone:dispatch-degraded', onClientEvent)
    if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('message', onSwMessage)
    }
    return () => {
      window.removeEventListener('helphone:dispatch-degraded', onClientEvent)
      if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage)
      }
    }
  }, [])

  if (!degraded) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="dispatch-degraded-banner"
      style={{
        background: 'rgba(255, 122, 107, 0.16)',
        color: colors.coral,
        borderBottom: `1px solid ${colors.coral}`,
        padding: '0.5rem 1rem',
        textAlign: 'center',
        fontSize: '0.85rem',
        fontWeight: 600,
      }}
    >
      Dispatch is overloaded — showing updates in low-bandwidth polling mode (~{Math.round(retryAfterMs / 1000)}s).
      Emergency requests are still being accepted.
    </div>
  )
}

export default DispatchDegradedBanner
