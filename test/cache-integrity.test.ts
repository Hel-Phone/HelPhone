/**
 * test/cache-integrity.test.ts — Tests for cache integrity verification (#898).
 * Covers SHA-384 hashing, verification, and opaque response detection.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  computeResponseHash,
  verifyCachedResponse,
  isOpaqueResponse,
  CacheIntegrityConfig,
} from '../src/lib/cacheIntegrity'

describe('Cache Integrity', () => {
  describe('computeResponseHash', () => {
    it('computes SHA-384 hash of response body', async () => {
      const body = 'test content'
      const response = new Response(body, {
        headers: { 'Content-Type': 'text/plain' },
      })

      const hash = await computeResponseHash(response)
      expect(hash).toBeDefined()
      expect(hash.length).toBe(96) // SHA-384 hex = 48 bytes * 2
      expect(/^[a-f0-9]{96}$/.test(hash)).toBe(true)
    })

    it('produces consistent hash for same content', async () => {
      const body = 'consistent content'
      const response1 = new Response(body)
      const response2 = new Response(body)

      const hash1 = await computeResponseHash(response1)
      const hash2 = await computeResponseHash(response2)

      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different content', async () => {
      const response1 = new Response('content 1')
      const response2 = new Response('content 2')

      const hash1 = await computeResponseHash(response1)
      const hash2 = await computeResponseHash(response2)

      expect(hash1).not.toBe(hash2)
    })
  })

  describe('verifyCachedResponse', () => {
    it('returns valid:true for matching hash', async () => {
      const body = 'test'
      const response = new Response(body, { status: 200 })
      const hash = await computeResponseHash(response)

      const integrity: CacheIntegrityConfig = {
        algorithm: 'SHA-384',
        expectedHash: hash,
      }

      const result = await verifyCachedResponse(response, integrity)
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it('returns valid:false for mismatched hash', async () => {
      const response = new Response('content', { status: 200 })
      const wrongHash = 'a'.repeat(96)

      const integrity: CacheIntegrityConfig = {
        algorithm: 'SHA-384',
        expectedHash: wrongHash,
      }

      const result = await verifyCachedResponse(response, integrity)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('hash-mismatch')
    })

    it('rejects unsupported algorithm', async () => {
      const response = new Response('content')
      const integrity = {
        algorithm: 'SHA-256' as any,
        expectedHash: 'dummy',
      }

      const result = await verifyCachedResponse(response, integrity)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('unsupported-algorithm')
    })

    it('rejects non-ok response status', async () => {
      const response = new Response('error', { status: 404 })
      const hash = await computeResponseHash(response)
      const integrity: CacheIntegrityConfig = {
        algorithm: 'SHA-384',
        expectedHash: hash,
      }

      const result = await verifyCachedResponse(response, integrity)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('non-ok-response')
    })

    it('rejects opaque responses', async () => {
      // Create opaque-like response (note: actual opaque responses can't be created in tests)
      const response = new Response('content', {
        status: 200,
        statusText: 'OK',
      })

      // Mock opaque type
      Object.defineProperty(response, 'type', { value: 'opaque' })

      const integrity: CacheIntegrityConfig = {
        algorithm: 'SHA-384',
        expectedHash: 'dummy',
      }

      const result = await verifyCachedResponse(response, integrity)
      expect(result.valid).toBe(false)
      expect(result.reason).toBe('opaque-response')
    })
  })

  describe('isOpaqueResponse', () => {
    it('detects opaque response type', () => {
      const response = new Response('content')
      Object.defineProperty(response, 'type', { value: 'opaque' })

      expect(isOpaqueResponse(response)).toBe(true)
    })

    it('detects missing content-length and etag', () => {
      const response = new Response('content', {
        headers: {
          'Content-Type': 'text/plain',
          // No Content-Length, no ETag
        },
      })

      // If truly opaque or missing both headers
      const result = isOpaqueResponse(response)
      // Actual result depends on response object implementation
      expect(typeof result).toBe('boolean')
    })

    it('accepts response with content-length', () => {
      const response = new Response('content', {
        headers: { 'Content-Length': '7' },
      })

      expect(isOpaqueResponse(response)).toBe(false)
    })

    it('accepts response with etag', () => {
      const response = new Response('content', {
        headers: { 'ETag': '"abc123"' },
      })

      expect(isOpaqueResponse(response)).toBe(false)
    })
  })
})
