/**
 * src/lib/cacheQuarantine.test.ts — Tests for cache quarantine store (#898).
 * Covers quarantine, unquarantine, and statistics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  quarantineResponse,
  isQuarantined,
  listQuarantined,
  unquarantine,
  clearQuarantine,
  getQuarantineStats,
} from './cacheQuarantine'

describe('Cache Quarantine', () => {
  beforeEach(async () => {
    // Clear quarantine before each test
    await clearQuarantine()
  })

  afterEach(async () => {
    // Clean up after tests
    await clearQuarantine()
  })

  it('quarantines a response', async () => {
    const url = 'https://example.com/asset.png'
    await quarantineResponse(url, 'hash-mismatch')

    const quarantined = await isQuarantined(url)
    expect(quarantined).toBe(true)
  })

  it('detects non-quarantined URL', async () => {
    const url = 'https://example.com/unknown.png'
    const quarantined = await isQuarantined(url)
    expect(quarantined).toBe(false)
  })

  it('lists all quarantined entries', async () => {
    const urls = [
      'https://example.com/asset1.png',
      'https://example.com/asset2.png',
      'https://example.com/asset3.js',
    ]

    for (const url of urls) {
      await quarantineResponse(url, 'hash-mismatch')
    }

    const list = await listQuarantined()
    expect(list.length).toBeGreaterThanOrEqual(3)
  })

  it('unquarantines a URL', async () => {
    const url = 'https://example.com/asset.png'
    await quarantineResponse(url, 'hash-mismatch')
    expect(await isQuarantined(url)).toBe(true)

    await unquarantine(url)
    expect(await isQuarantined(url)).toBe(false)
  })

  it('provides quarantine statistics', async () => {
    // Add various types of quarantined entries
    await quarantineResponse('https://example.com/poisoned', 'poisoned')
    await quarantineResponse('https://example.com/opaque', 'opaque-response')
    await quarantineResponse('https://example.com/mismatch', 'hash-mismatch')

    const stats = await getQuarantineStats()
    expect(stats.total).toBeGreaterThanOrEqual(3)
    expect(stats.poisoned).toBeGreaterThanOrEqual(1)
    expect(stats.opaque).toBeGreaterThanOrEqual(1)
    expect(stats.mismatch).toBeGreaterThanOrEqual(1)
  })

  it('clears all quarantine entries', async () => {
    const urls = ['https://example.com/1.png', 'https://example.com/2.png']

    for (const url of urls) {
      await quarantineResponse(url, 'poisoned')
    }

    await clearQuarantine()

    for (const url of urls) {
      expect(await isQuarantined(url)).toBe(false)
    }
  })

  it('handles multiple reasons separately', async () => {
    await quarantineResponse('https://example.com/poisoned', 'poisoned')
    await quarantineResponse('https://example.com/opaque', 'opaque-response')

    const list = await listQuarantined()
    const poisoned = list.find((e) => e.reason === 'poisoned')
    const opaque = list.find((e) => e.reason === 'opaque-response')

    expect(poisoned).toBeDefined()
    expect(opaque).toBeDefined()
  })

  it('records detection time', async () => {
    const url = 'https://example.com/asset.png'
    const before = Date.now()

    await quarantineResponse(url, 'hash-mismatch')

    const after = Date.now()
    const list = await listQuarantined()
    const entry = list.find((e) => e.url === url)

    expect(entry).toBeDefined()
    expect(entry?.detectedAt).toBeGreaterThanOrEqual(before)
    expect(entry?.detectedAt).toBeLessThanOrEqual(after)
  })
})
