import { rateLimit, type Options } from 'express-rate-limit'
import type { NextFunction, Request, Response } from 'express'
import { isWhitelisted } from './whitelist.js'

/**
 * Rate-limit tiers.
 *
 * Proof generation is CPU-intensive; restrict to 10 requests per minute
 * per IP to protect the server from abuse while still allowing
 * legitimate use (a single user rarely needs more than a few proofs/min).
 *
 * The general limiter is mounted on /api after the body parser. Auth and
 * telemetry get tighter budgets, but all tiers return a JSON envelope with
 * Retry-After and the standard draft-7 headers, including for preflight.
 */

export interface LimiterOptions {
  windowMs?: number
  max?: number
  message?: string
  skipSuccessfulRequests?: boolean
  skip?: (req: Request) => boolean
}

export function createLimiter(options: LimiterOptions = {}) {
  const message = options.message ?? 'Too many requests — please slow down and try again shortly.'
  const config: Partial<Options> = {
    windowMs: options.windowMs ?? 60_000,
    max: options.max ?? 100,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests ?? false,
    skip: options.skip ?? isWhitelisted,
    handler: (_req, res) => {
      res.status(429).json({ success: false, error: message, code: 'rate_limited' })
    },
  }
  return rateLimit(config)
}

/** General API budget: 100 req/min/IP. */
export const generalLimiter = createLimiter({
  windowMs: 60_000,
  max: 100,
  message: 'Too many requests — please slow down and try again shortly.',
})

/** ZK proving is CPU-bound: 10 req/min/IP. */
export const proverLimiter = createLimiter({
  windowMs: 60_000,
  max: 10,
  message: 'ZK prover rate limit exceeded — at most 10 proofs per minute per IP.',
})

/** Telemetry ingest gets a higher rate but its own bucket. */
export const telemetryLimiter = createLimiter({
  windowMs: 60_000,
  max: 240,
  message: 'Telemetry ingest rate limit exceeded.',
})

/** Passkey/session endpoints: 20 req/min/IP. */
export const authLimiter = createLimiter({
  windowMs: 60_000,
  max: 20,
  message: 'Authentication rate limit exceeded.',
})

/** Read-only data API: 300 req/min/IP. */
export const dataLimiter = createLimiter({ windowMs: 60_000, max: 300 })

// ── Rejoin allowlist (#909) ────────────────────────────────────────────────
//
// A WS responder whose socket was reaped by the server while the tab was in
// mobile background must be able to rejoin its active dispatch claim without
// losing it.  Three problems compound without this:
//
//   1. The server reaps the socket and marks the claim unassigned.
//   2. The responder reconnects and POSTs /api/dispatch/rejoin.
//   3. Without an allowlist the rejoin hits the general 100 req/min/IP tier,
//      which a flood of rapid reconnects (poor signal, aggressive app-switcher)
//      can exhaust, locking out the legitimate responder.
//
// The allowlist gates rejoin requests by authenticated session ID.  On first
// rejoin the session is admitted and its backoff counter is reset.  Flood
// detection (> REJOIN_FLOOD_THRESHOLD rejoins per session per window) evicts
// the session from the allowlist so it must re-authenticate — preventing a
// broken client from hammering the dispatch core.

/** Max rejoins a single session may attempt per REJOIN_WINDOW_MS before eviction. */
export const REJOIN_FLOOD_THRESHOLD = 5
/** Rolling window for rejoin flood detection (ms). */
export const REJOIN_WINDOW_MS = 60_000
/** How long an evicted session must wait before it may rejoin again (ms). */
export const REJOIN_BACKOFF_MS = 30_000

interface RejoinEntry {
  admittedAt: number
  rejoins: number
  windowStart: number
  evictedUntil: number
}

export class RejoinAllowlist {
  private sessions = new Map<string, RejoinEntry>()

  /** Add a session to the allowlist (called after WS auth handshake succeeds). */
  admit(sessionId: string): void {
    const existing = this.sessions.get(sessionId)
    this.sessions.set(sessionId, {
      admittedAt: existing?.admittedAt ?? Date.now(),
      rejoins: 0,
      windowStart: Date.now(),
      evictedUntil: 0,
    })
  }

  /** Remove a session (called on clean disconnect or session expiry). */
  evict(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Check whether a rejoin is permitted for the given session.
   * Returns `{ allowed: true }` or `{ allowed: false, retryAfterMs }`.
   * Side-effect: increments the rejoin counter; evicts on flood.
   */
  checkRejoin(sessionId: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const entry = this.sessions.get(sessionId)
    const now = Date.now()

    if (!entry) {
      // Unknown session — not in allowlist; must authenticate first.
      return { allowed: false, retryAfterMs: 0 }
    }

    if (now < entry.evictedUntil) {
      return { allowed: false, retryAfterMs: entry.evictedUntil - now }
    }

    // Roll the flood-detection window.
    if (now - entry.windowStart > REJOIN_WINDOW_MS) {
      entry.rejoins = 0
      entry.windowStart = now
    }

    entry.rejoins++

    if (entry.rejoins > REJOIN_FLOOD_THRESHOLD) {
      entry.evictedUntil = now + REJOIN_BACKOFF_MS
      entry.rejoins = 0
      entry.windowStart = now
      return { allowed: false, retryAfterMs: REJOIN_BACKOFF_MS }
    }

    return { allowed: true }
  }

  /** Current allowlist size (for diagnostics). */
  size(): number {
    return this.sessions.size
  }

  /** Purge entries that have been fully idle for longer than `ttlMs`. */
  gc(ttlMs = 10 * 60_000, now = Date.now()): void {
    for (const [id, entry] of this.sessions) {
      if (now - entry.admittedAt > ttlMs && now >= entry.evictedUntil) {
        this.sessions.delete(id)
      }
    }
  }
}

/** Process-level singleton — import and call `.admit(sessionId)` on WS auth. */
export const rejoinAllowlist = new RejoinAllowlist()

/**
 * Express rate-limiter for POST /api/dispatch/rejoin.
 * Tighter than the general budget (5 req/min/IP) so a reconnect storm cannot
 * exhaust the global limit for other clients on the same egress IP.
 * Mount this BEFORE the general limiter on the rejoin route.
 */
export const rejoinLimiter = createLimiter({
  windowMs: REJOIN_WINDOW_MS,
  max: REJOIN_FLOOD_THRESHOLD,
  message: 'Rejoin rate limit exceeded — wait before reconnecting.',
})

export const rateLimiters = {
  general: generalLimiter,
  prover: proverLimiter,
  telemetry: telemetryLimiter,
  auth: authLimiter,
  data: dataLimiter,
  rejoin: rejoinLimiter,
}

// ── Wallet-scoped request-creation limits (ADR-020 risk mitigation) ─────────
//
// A requester who cycles `type=medical` must not monopolise the P0 tier. Limits
// are keyed on the wallet, escalate exponentially, and are held in a store that
// can be shared across processes. Metric labels are fixed enums + a small
// backoff level — a wallet address can never become a Prometheus label.

export interface SharedLimitStore {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>
  set(key: string, value: number, ttlMs: number): Promise<void>
  get(key: string): Promise<number | null>
  delete(key: string): Promise<void>
}

interface MemoryEntry {
  count: number
  resetAt: number
}

/** Default single-process store. Multi-process deployments inject a Redis store. */
export function createMemoryLimitStore(): SharedLimitStore {
  const counters = new Map<string, MemoryEntry>()
  const values = new Map<string, { value: number; expiresAt: number }>()

  return {
    async increment(key, windowMs, now = Date.now()) {
      const entry = counters.get(key)
      if (!entry || now >= entry.resetAt) {
        const next = { count: 1, resetAt: now + windowMs }
        counters.set(key, next)
        return next
      }
      entry.count += 1
      return { count: entry.count, resetAt: entry.resetAt }
    },
    async set(key, value, ttlMs) {
      values.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
    async get(key) {
      const entry = values.get(key)
      if (!entry) return null
      if (Date.now() >= entry.expiresAt) {
        values.delete(key)
        return null
      }
      return entry.value
    },
    async delete(key) {
      counters.delete(key)
      values.delete(key)
    },
  }
}

/**
 * Redis-backed store for multi-process deployments. One Lua round-trip keeps
 * INCR + EXPIRE atomic, so two workers cannot both admit the last request.
 */
export function createRedisLimitStore(client: {
  eval(script: string, numKeys: number, key: string, ...args: Array<string | number>): Promise<unknown>
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>
  get(key: string): Promise<string | null>
  del(key: string): Promise<unknown>
}): SharedLimitStore {
  const incrementScript =
    'local n = redis.call("INCR", KEYS[1]) ' +
    'if n == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end ' +
    'return n'

  return {
    async increment(key, windowMs) {
      const count = Number(await client.eval(incrementScript, 1, key, windowMs))
      return { count, resetAt: Date.now() + windowMs }
    },
    async set(key, value, ttlMs) {
      await client.set(key, String(value), 'PX', ttlMs)
    },
    async get(key) {
      const value = await client.get(key)
      return value === null ? null : Number(value)
    },
    async delete(key) {
      await client.del(key)
    },
  }
}

export type WalletLimitReason = 'ok' | 'limit' | 'backoff' | 'verified_exempt'

export interface WalletLimitDecision {
  allowed: boolean
  reason: WalletLimitReason
  level: number
  retryAfterMs: number
}

export interface WalletRequestLimiterOptions {
  store?: SharedLimitStore
  maxRequests?: number
  windowMs?: number
  baseBackoffMs?: number
  maxBackoffMs?: number
  maxLevel?: number
  escalationWindowMs?: number
  /** Verified responders are exempt from request-creation throttling. */
  isVerifiedResponder?: (wallet: string, req?: Request) => boolean | Promise<boolean>
}

export interface AbuseMetricFamily {
  name: string
  help: string
  type: 'counter'
  samples: Array<{ labels: Record<string, string>; value: number }>
}

export const WALLET_ABUSE_METRIC_NAME = 'helphone_dispatch_wallet_abuse_total'

export class WalletRequestLimiter {
  private readonly store: SharedLimitStore
  private readonly maxRequests: number
  private readonly windowMs: number
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly maxLevel: number
  private readonly escalationWindowMs: number
  private readonly isVerifiedResponder?: WalletRequestLimiterOptions['isVerifiedResponder']
  /** Keys are `${reason}:${level}` — both bounded enums, never a wallet. */
  private abuse = new Map<string, number>()

  constructor(options: WalletRequestLimiterOptions = {}) {
    this.store = options.store ?? createMemoryLimitStore()
    this.maxRequests = options.maxRequests ?? 12
    this.windowMs = options.windowMs ?? 60_000
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000
    this.maxLevel = options.maxLevel ?? 5
    this.escalationWindowMs = options.escalationWindowMs ?? 10 * 60_000
    this.isVerifiedResponder = options.isVerifiedResponder
  }

  private record(reason: WalletLimitReason, level: number): void {
    const key = `${reason}:${level}`
    this.abuse.set(key, (this.abuse.get(key) ?? 0) + 1)
  }

  async check(wallet: string, req?: Request, now = Date.now()): Promise<WalletLimitDecision> {
    const key = wallet || 'anonymous'

    if (this.isVerifiedResponder) {
      const exempt = await this.isVerifiedResponder(key, req)
      if (exempt) {
        this.record('verified_exempt', 0)
        return { allowed: true, reason: 'verified_exempt', level: 0, retryAfterMs: 0 }
      }
    }

    const level = (await this.store.get(`wl:level:${key}`)) ?? 1
    const blockedUntil = await this.store.get(`wl:blocked:${key}`)
    if (blockedUntil !== null && now < blockedUntil) {
      this.record('backoff', level)
      return {
        allowed: false,
        reason: 'backoff',
        level,
        retryAfterMs: Math.max(1, blockedUntil - now),
      }
    }

    const usage = await this.store.increment(`wl:count:${key}`, this.windowMs, now)
    if (usage.count > this.maxRequests) {
      const violations = await this.store.increment(`wl:violations:${key}`, this.escalationWindowMs, now)
      const nextLevel = Math.min(Math.max(1, violations.count), this.maxLevel)
      const backoffMs = Math.min(this.baseBackoffMs * Math.pow(2, nextLevel - 1), this.maxBackoffMs)
      await this.store.set(`wl:blocked:${key}`, now + backoffMs, backoffMs)
      await this.store.set(`wl:level:${key}`, nextLevel, this.escalationWindowMs)
      this.record('limit', nextLevel)
      return { allowed: false, reason: 'limit', level: nextLevel, retryAfterMs: backoffMs }
    }

    this.record('ok', 0)
    return { allowed: true, reason: 'ok', level: 0, retryAfterMs: 0 }
  }

  /** Low-cardinality abuse metrics: only reason + bounded backoff level. */
  getAbuseMetrics(): AbuseMetricFamily[] {
    const samples = Array.from(this.abuse.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [reason, level] = key.split(':')
        return { labels: { reason, level }, value }
      })
    return [
      {
        name: WALLET_ABUSE_METRIC_NAME,
        help: 'Wallet-scoped request-creation limit decisions by reason and bounded backoff level.',
        type: 'counter',
        samples,
      },
    ]
  }

  reset(): void {
    this.abuse.clear()
  }
}

export function abuseMetricFamilies(limiter: WalletRequestLimiter): AbuseMetricFamily[] {
  return limiter.getAbuseMetrics()
}

/** Extract the wallet from a request-creation call, falling back to the IP. */
export function walletOfRequest(req: Request): string {
  const header = req.headers['x-wallet']
  if (typeof header === 'string' && header.trim()) return header.trim()
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
  for (const key of ['wallet', 'responderWallet', 'requester']) {
    if (typeof body[key] === 'string' && (body[key] as string).trim()) return (body[key] as string).trim()
  }
  return `anonymous:${req.ip ?? 'unknown'}`
}

/** Reusable middleware form of the wallet limiter. */
export function createWalletRequestLimiterMiddleware(limiter: WalletRequestLimiter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const decision = await limiter.check(walletOfRequest(req), req)
    if (!decision.allowed) {
      res.set('Retry-After', String(Math.ceil(decision.retryAfterMs / 1000)))
      res.status(429).json({
        success: false,
        error: 'Wallet request limit exceeded — backoff in effect.',
        code: 'wallet_backoff',
        reason: decision.reason,
        backoffLevel: decision.level,
      })
      return
    }
    next()
  }
}

export default createLimiter
