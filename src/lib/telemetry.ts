const HEX = '0123456789abcdef'

function randomHex(length: number): string {
  const bytes = new Uint8Array(length / 2)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => `${HEX[byte >> 4]}${HEX[byte & 15]}`).join('')
}

export function createTraceparent(): string {
  return `00-${randomHex(32)}-${randomHex(16)}-01`
}

export function reportClientError(error: Error, componentStack?: string): string | null {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null
  const traceparent = createTraceparent()
  void fetch('/api/telemetry/errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json', traceparent },
    body: JSON.stringify({
      message: error.message,
      componentStack: componentStack?.slice(0, 2000),
    }),
    keepalive: true,
  }).catch(() => undefined)
  return traceparent.split('-')[1]
}
