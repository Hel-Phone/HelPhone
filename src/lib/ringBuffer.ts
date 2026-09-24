/**
 * Client-side view of the contract's bounded verification history (#531).
 *
 * Mirrors `contract/contracts/helphone-contract/src/ring_buffer.rs`: logical
 * indexes only grow, and once more than `capacity` entries exist the oldest
 * `total - capacity` of them are gone.
 */
import type { ExpertVerificationWindow } from '../types/index'

function toCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

/** Derive the readable window from the contract's lifetime total and capacity. */
export function verificationWindow(total: unknown, capacity: unknown): ExpertVerificationWindow {
  const t = toCount(total)
  const c = toCount(capacity)
  const oldest = Math.max(t - c, 0)
  return { total: t, capacity: c, oldest, retained: t - oldest, evicted: oldest }
}

/** Whether logical `index` can still be read from the contract. */
export function isRetained(window: ExpertVerificationWindow, index: number): boolean {
  return Number.isInteger(index) && index >= window.oldest && index < window.total
}

/**
 * Logical indexes of the newest `limit` retained entries, newest first: what
 * to fetch to show a wallet's recent history without asking for evicted slots.
 */
export function recentIndexes(window: ExpertVerificationWindow, limit: number): number[] {
  const count = Math.min(Math.max(Math.trunc(limit) || 0, 0), window.retained)
  return Array.from({ length: count }, (_, i) => window.total - 1 - i)
}
