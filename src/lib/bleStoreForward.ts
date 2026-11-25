/**
 * src/lib/bleStoreForward.ts — BLE beacon store-and-forward with TTL-based deduplication.
 * Persistent offline queue for beacons that cannot be relayed immediately.
 * Integrates with syncManager.ts for CRDT message layer broadcasting.
 */

import { Beacon } from './bleRelay'

export interface StoredBeacon {
  beacon: Beacon
  expiresAt: number
  hops: number
  receivedAt: number
}

export class BleStoreForwardManager {
  private storage = new Map<string, StoredBeacon>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly maxTtlMarginMs: number

  constructor(capacity = 100, ttlMs = 5 * 60_000, maxTtlMarginMs = 60_000) {
    this.capacity = capacity
    this.ttlMs = ttlMs
    this.maxTtlMarginMs = maxTtlMarginMs
  }

  /**
   * Store a beacon if not already present (deduplicated by signature).
   * Evicts oldest on overflow.
   */
  store(beacon: Beacon, hops: number): boolean {
    const key = this.deduplicationKey(beacon)

    if (this.storage.has(key)) {
      return false // already stored
    }

    const now = Date.now()
    const beaconExpiryMs = beacon.expiresAt * 1000
    const expiresAt = Math.min(beaconExpiryMs + this.maxTtlMarginMs, now + this.ttlMs)

    if (expiresAt <= now) {
      return false // already expired
    }

    if (this.storage.size >= this.capacity) {
      this.evictOldest()
    }

    this.storage.set(key, {
      beacon,
      expiresAt,
      hops: hops + 1,
      receivedAt: now,
    })

    return true
  }

  /**
   * Retrieve non-expired beacons, ordered by freshness (newest first).
   */
  retrieve(limit = 10): Beacon[] {
    const now = Date.now()
    const valid: Array<{ beacon: Beacon; receivedAt: number }> = []

    for (const entry of this.storage.values()) {
      if (entry.expiresAt > now) {
        valid.push({ beacon: entry.beacon, receivedAt: entry.receivedAt })
      }
    }

    valid.sort((a, b) => b.receivedAt - a.receivedAt)
    return valid.slice(0, limit).map((v) => v.beacon)
  }

  /**
   * Remove a beacon after successful relay.
   */
  remove(beacon: Beacon): void {
    const key = this.deduplicationKey(beacon)
    this.storage.delete(key)
  }

  /**
   * Remove all expired beacons.
   */
  purge(): number {
    const now = Date.now()
    const before = this.storage.size

    for (const [key, entry] of this.storage) {
      if (entry.expiresAt <= now) {
        this.storage.delete(key)
      }
    }

    return before - this.storage.size
  }

  get size(): number {
    return this.storage.size
  }

  private deduplicationKey(beacon: Beacon): string {
    return `${beacon.signer}:${beacon.incidentId}:${beacon.seq}`
  }

  private evictOldest(): void {
    let oldest: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.storage) {
      if (entry.receivedAt < oldestTime) {
        oldestTime = entry.receivedAt
        oldest = key
      }
    }

    if (oldest) {
      this.storage.delete(oldest)
    }
  }
}
