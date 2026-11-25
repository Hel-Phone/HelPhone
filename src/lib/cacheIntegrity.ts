/**
 * src/lib/cacheIntegrity.ts — Cache response integrity verification for PWA safety (#898).
 * Verifies SHA-384 hashes of responses before caching to prevent poisoning attacks.
 */

export interface CacheIntegrityConfig {
  algorithm: 'SHA-384'
  expectedHash: string
}

export interface VerificationResult {
  valid: boolean
  reason?: string
}

/**
 * Compute SHA-384 hash of response body.
 * Uses crypto.subtle API (available in all modern browsers).
 */
export async function computeResponseHash(response: Response): Promise<string> {
  const clone = response.clone()
  const buffer = await clone.arrayBuffer()
  const hashBuffer = await crypto.subtle.digest('SHA-384', buffer)
  return bufferToHex(hashBuffer)
}

/**
 * Verify cached response against expected SHA-384 hash.
 * Returns {valid: true} if match, {valid: false, reason} otherwise.
 */
export async function verifyCachedResponse(
  response: Response,
  integrity: CacheIntegrityConfig
): Promise<VerificationResult> {
  if (integrity.algorithm !== 'SHA-384') {
    return { valid: false, reason: 'unsupported-algorithm' }
  }

  if (!response.ok) {
    return { valid: false, reason: 'non-ok-response' }
  }

  if (response.type === 'opaque') {
    return { valid: false, reason: 'opaque-response' }
  }

  try {
    const hash = await computeResponseHash(response)
    if (hash === integrity.expectedHash) {
      return { valid: true }
    }
    return { valid: false, reason: 'hash-mismatch' }
  } catch (err) {
    return { valid: false, reason: 'hash-computation-failed' }
  }
}

/**
 * Convert ArrayBuffer to hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Check if response is opaque (no content-length, no ETag, cannot be verified).
 */
export function isOpaqueResponse(response: Response): boolean {
  return (
    response.type === 'opaque' ||
    (!response.headers.get('Content-Length') && !response.headers.get('ETag'))
  )
}
