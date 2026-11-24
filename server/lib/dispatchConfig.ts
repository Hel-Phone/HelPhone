/**
 * Server-side dispatch configuration.
 *
 * The ADR-020 queue bounds and overload behaviour are public feature config in
 * `public/config.json` so operators can tune them without a redeploy of code.
 * Defaults mirror the ADR-020 Option B table and are applied when a key is
 * missing or malformed. Environment variables override the file for drills.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DispatchQueueBounds } from '../../src/lib/dispatchQueue.ts'
import { DEFAULT_DISPATCH_BOUNDS, DEFAULT_MEMORY_BUDGET_ITEMS } from '../../src/lib/dispatchQueue.ts'

export interface DispatchConfig {
  bounds: DispatchQueueBounds
  memoryBudgetItems: number
  /** Retry-After advertised with 503 Overloaded, in seconds. */
  overloadedRetryAfterSeconds: number
  /** Upper bound for client polling while degraded, in ms. */
  pollingIntervalMs: number
  wallet: {
    maxRequests: number
    windowMs: number
    baseBackoffMs: number
    maxBackoffMs: number
    maxLevel: number
    escalationWindowMs: number
  }
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  bounds: { ...DEFAULT_DISPATCH_BOUNDS },
  memoryBudgetItems: DEFAULT_MEMORY_BUDGET_ITEMS,
  overloadedRetryAfterSeconds: 5,
  pollingIntervalMs: 5_000,
  wallet: {
    maxRequests: 12,
    windowMs: 60_000,
    baseBackoffMs: 1_000,
    maxBackoffMs: 60_000,
    maxLevel: 5,
    escalationWindowMs: 10 * 60_000,
  },
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

// Resolve from cwd (the repo root for `npm test` and `npm start`). Some bundler
// transforms give import.meta.url a non-file scheme, so it is deliberately not
// used here. A missing file simply falls back to the ADR-020 defaults.
const defaultConfigPath = resolve(process.cwd(), 'public/config.json')

/**
 * Load the `dispatch` block from public/config.json, merging it over defaults.
 * A missing/unreadable file is never fatal — the ADR-020 defaults apply.
 */
export function loadDispatchConfig(configPath: string = defaultConfigPath): DispatchConfig {
  const config: DispatchConfig = {
    bounds: { ...DEFAULT_DISPATCH_CONFIG.bounds },
    memoryBudgetItems: DEFAULT_DISPATCH_CONFIG.memoryBudgetItems,
    overloadedRetryAfterSeconds: DEFAULT_DISPATCH_CONFIG.overloadedRetryAfterSeconds,
    pollingIntervalMs: DEFAULT_DISPATCH_CONFIG.pollingIntervalMs,
    wallet: { ...DEFAULT_DISPATCH_CONFIG.wallet },
  }

  let raw: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    const section = parsed?.dispatch
    if (section && typeof section === 'object') raw = section as Record<string, unknown>
  } catch {
    // Config is best-effort; ADR-020 defaults keep the server safe.
  }

  const bounds = raw.bounds && typeof raw.bounds === 'object' ? (raw.bounds as Record<string, unknown>) : {}
  config.bounds = {
    critical: positiveInt(bounds.critical, config.bounds.critical),
    high: positiveInt(bounds.high, config.bounds.high),
    normal: positiveInt(bounds.normal, config.bounds.normal),
    low: positiveInt(bounds.low, config.bounds.low),
  }
  // P0 is never bounded, regardless of config.
  config.bounds.critical = Number.POSITIVE_INFINITY

  config.memoryBudgetItems = positiveInt(raw.memoryBudgetItems, config.memoryBudgetItems)
  config.overloadedRetryAfterSeconds = positiveInt(raw.overloadedRetryAfterSeconds, config.overloadedRetryAfterSeconds)
  config.pollingIntervalMs = positiveInt(raw.pollingIntervalMs, config.pollingIntervalMs)

  const wallet = raw.wallet && typeof raw.wallet === 'object' ? (raw.wallet as Record<string, unknown>) : {}
  config.wallet = {
    maxRequests: positiveInt(wallet.maxRequests, config.wallet.maxRequests),
    windowMs: positiveInt(wallet.windowMs, config.wallet.windowMs),
    baseBackoffMs: positiveInt(wallet.baseBackoffMs, config.wallet.baseBackoffMs),
    maxBackoffMs: positiveInt(wallet.maxBackoffMs, config.wallet.maxBackoffMs),
    maxLevel: positiveInt(wallet.maxLevel, config.wallet.maxLevel),
    escalationWindowMs: positiveInt(wallet.escalationWindowMs, config.wallet.escalationWindowMs),
  }

  // Environment overrides support chaos drills without editing checked-in config.
  if (process.env.DISPATCH_MEMORY_BUDGET) {
    config.memoryBudgetItems = positiveInt(Number(process.env.DISPATCH_MEMORY_BUDGET), config.memoryBudgetItems)
  }
  if (process.env.DISPATCH_OVERLOAD_RETRY_AFTER_SECONDS) {
    config.overloadedRetryAfterSeconds = positiveInt(
      Number(process.env.DISPATCH_OVERLOAD_RETRY_AFTER_SECONDS),
      config.overloadedRetryAfterSeconds,
    )
  }
  if (process.env.DISPATCH_WALLET_MAX_REQUESTS) {
    config.wallet.maxRequests = positiveInt(Number(process.env.DISPATCH_WALLET_MAX_REQUESTS), config.wallet.maxRequests)
  }

  return config
}
