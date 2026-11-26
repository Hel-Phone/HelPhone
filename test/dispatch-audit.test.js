// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import {
  recordDispatchShed,
  latestDispatchShed,
  clearDispatchShed,
  getDispatchShedSink,
} from '../server/indexer/auditStreamer.js'
import { DispatchQueue } from '../src/lib/dispatchQueue.js'
import { dispatchMetricFamilies } from '../server/routes/dispatch.js'
import { WalletRequestLimiter, createMemoryLimitStore } from '../server/middleware/rateLimiter.js'

const SENSITIVE_WALLET = 'GCITIZENWALLETADDRESS_926_PII'

beforeEach(() => {
  clearDispatchShed()
})

describe('ADR-020 — shed audit stream carries timestamp, tier and reason but no PII', () => {
  it('allow-lists audit fields and drops caller-supplied identity fields', async () => {
    await recordDispatchShed(
      {
        at: 1_700_000_000_000,
        tier: 'P3',
        reason: 'coalesced',
        messageType: 'LocUpd',
        wallet: SENSITIVE_WALLET,
        requestId: 'req-123',
        note: 'caller name Jane Doe phone +12223334444',
        actor: SENSITIVE_WALLET,
      },
      1_700_000_000_000,
    )

    const [row] = await latestDispatchShed(1)
    expect(row.type).toBe('dispatch_shed')
    expect(row.source).toBe('dispatch_shed')
    expect(row.observedAt).toBe(new Date(1_700_000_000_000).toISOString())
    expect(row.actor).toBeNull()
    expect(row.payload.tier).toBe('P3')
    expect(row.payload.reason).toBe('coalesced')
    expect(row.payload.messageType).toBe('LocUpd')
    expect(row.payload.at).toBe(1_700_000_000_000)
    expect(JSON.stringify(row)).not.toContain(SENSITIVE_WALLET)
    expect(JSON.stringify(row)).not.toContain('Jane Doe')
    expect(JSON.stringify(row)).not.toContain('req-123')
  })

  it('writes one audit row per shed event from the queue hook', async () => {
    const queue = new DispatchQueue({
      bounds: { low: 1 },
      memoryBudgetItems: 100,
      onShed: (event) => void recordDispatchShed(event),
    })
    const base = { priority: 'low', payload: {}, timestamp: Date.now(), maxRetries: 1 }
    queue.enqueue({ ...base, id: 'a' })
    queue.enqueue({ ...base, id: 'b' })
    queue.enqueue({ ...base, id: 'c' })

    await Promise.resolve()
    const rows = await latestDispatchShed(10)
    expect(rows.length).toBe(2)
    expect(rows.every((row) => row.payload.reason === 'queue_bound')).toBe(true)
    expect(getDispatchShedSink().events.length).toBe(2)
  })

  it('exports abuse metrics with fixed low-cardinality labels and no wallet', () => {
    const limiter = new WalletRequestLimiter({
      store: createMemoryLimitStore(),
      maxRequests: 1,
      baseBackoffMs: 1_000,
    })
    return limiter.check(SENSITIVE_WALLET).then(async () => {
      await limiter.check(SENSITIVE_WALLET)
      const families = dispatchMetricFamilies({
        store: { stats: () => ({ requests: 0, envelopes: 0, keys: 0 }) },
        rejectedPlaintext: 0,
        rejectedMalformed: 0,
        writes: 0,
        reads: 0,
        rateLimited: 0,
        walletLimiter: limiter,
      })
      const abuse = families.find((family) => family.name === 'helphone_dispatch_wallet_abuse_total')
      expect(abuse).toBeDefined()
      expect(abuse.samples.length).toBeGreaterThan(0)
      expect(JSON.stringify(abuse)).not.toContain(SENSITIVE_WALLET)
      for (const sample of abuse.samples) {
        expect(['ok', 'limit', 'backoff', 'verified_exempt']).toContain(sample.labels.reason)
        expect(Number(sample.labels.level)).toBeLessThanOrEqual(5)
      }
    })
  })
})
