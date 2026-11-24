// @vitest-environment node
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  WalletRequestLimiter,
  createMemoryLimitStore,
  createWalletRequestLimiterMiddleware,
  abuseMetricFamilies,
  walletOfRequest,
} from '../server/middleware/rateLimiter.js'
import { priorityForMessage } from '../server/middleware/dispatchPriority.js'

const WALLET = 'GABCDEFWALLETADDRESS1234567890'

describe('ADR-020 — wallet-scoped request limits with escalating backoff', () => {
  it('stops a wallet cycling type=medical from monopolising P0', async () => {
    const limiter = new WalletRequestLimiter({
      store: createMemoryLimitStore(),
      maxRequests: 2,
      baseBackoffMs: 1_000,
      maxBackoffMs: 10_000,
    })
    expect(priorityForMessage('RqCreated', 'medical')).toBe('critical')

    const t0 = Date.now()
    const first = await limiter.check(WALLET, undefined, t0)
    const second = await limiter.check(WALLET, undefined, t0 + 10)
    const third = await limiter.check(WALLET, undefined, t0 + 20)
    const blocked = await limiter.check(WALLET, undefined, t0 + 500)
    const escalated = await limiter.check(WALLET, undefined, t0 + 1_500)

    // Only the first two "medical" requests are admitted; the rest back off.
    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(true)
    expect(third.allowed).toBe(false)
    expect(third.reason).toBe('limit')
    expect(third.level).toBe(1)
    expect(third.retryAfterMs).toBe(1_000)
    expect(blocked.reason).toBe('backoff')
    // After the backoff expires, a further violation escalates to level 2.
    expect(escalated.allowed).toBe(false)
    expect(escalated.reason).toBe('limit')
    expect(escalated.level).toBe(2)
    expect(escalated.retryAfterMs).toBe(2_000)
  })

  it('shares limits across processes through a shared store', async () => {
    const store = createMemoryLimitStore()
    const workerA = new WalletRequestLimiter({ store, maxRequests: 3 })
    const workerB = new WalletRequestLimiter({ store, maxRequests: 3 })

    expect((await workerA.check(WALLET)).allowed).toBe(true)
    expect((await workerB.check(WALLET)).allowed).toBe(true)
    expect((await workerA.check(WALLET)).allowed).toBe(true)
    expect((await workerB.check(WALLET)).allowed).toBe(false) // 4th across both workers
  })

  it('exempts verified responders while still metering other wallets', async () => {
    const limiter = new WalletRequestLimiter({
      store: createMemoryLimitStore(),
      maxRequests: 1,
      isVerifiedResponder: (wallet) => wallet === 'VERIFIED_RESPONDER',
    })

    for (let i = 0; i < 10; i++) {
      expect((await limiter.check('VERIFIED_RESPONDER')).allowed).toBe(true)
    }
    expect((await limiter.check(WALLET)).allowed).toBe(true)
    expect((await limiter.check(WALLET)).allowed).toBe(false)
  })

  it('never puts a wallet address in a metric label', async () => {
    const limiter = new WalletRequestLimiter({
      store: createMemoryLimitStore(),
      maxRequests: 1,
    })
    await limiter.check(WALLET)
    await limiter.check(WALLET)
    const serialized = JSON.stringify(abuseMetricFamilies(limiter))
    expect(serialized).not.toContain(WALLET)
    expect(serialized).toContain('helphone_dispatch_wallet_abuse_total')
    expect(serialized).toContain('"reason":"limit"')
  })

  it('returns 429 with Retry-After from the Express middleware', async () => {
    const limiter = new WalletRequestLimiter({
      store: createMemoryLimitStore(),
      maxRequests: 1,
      baseBackoffMs: 2_000,
    })
    const app = express()
    app.use(express.json())
    app.post('/request', createWalletRequestLimiterMiddleware(limiter), (_req, res) => res.json({ ok: true }))

    await request(app).post('/request').send({ wallet: WALLET, type: 'medical' }).expect(200)
    const rejected = await request(app)
      .post('/request')
      .send({ wallet: WALLET, type: 'medical' })
      .expect(429)
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0)
    expect(rejected.body.code).toBe('wallet_backoff')
    expect(rejected.body.reason).toBe('limit')
  })

  it('extracts the wallet from header or body without leaking it into metrics', () => {
    const fromHeader = walletOfRequest({ headers: { 'x-wallet': WALLET }, body: {} })
    const fromBody = walletOfRequest({ headers: {}, body: { wallet: WALLET } })
    const anonymous = walletOfRequest({ headers: {}, body: {}, ip: '127.0.0.1' })
    expect(fromHeader).toBe(WALLET)
    expect(fromBody).toBe(WALLET)
    expect(anonymous).toBe('anonymous:127.0.0.1')
  })
})
