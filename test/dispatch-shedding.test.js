// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import {
  DispatchQueue,
  DEFAULT_DISPATCH_BOUNDS,
  toAdr020Tier,
  toQueuePriority,
} from '../src/lib/dispatchQueue.js'
import { detectPriority, priorityForMessage, tierForMessage } from '../server/middleware/dispatchPriority.js'
import { loadDispatchConfig, DEFAULT_DISPATCH_CONFIG } from '../server/lib/dispatchConfig.js'
import { createDispatchRouters, createMemoryDispatchStore } from '../server/routes/dispatch.js'
import { latestDispatchShed, clearDispatchShed } from '../server/indexer/auditStreamer.js'

const now = () => Date.now()

describe('ADR-020 — four bounded tiers, configurable bounds, P0 never shed', () => {
  it('respects P1/P2/P3 bounds under a 5,000-message surge while P0 survives', () => {
    const queue = new DispatchQueue({
      bounds: { critical: Infinity, high: 10, normal: 10, low: 5 },
      memoryBudgetItems: 100_000,
    })

    for (let i = 0; i < 5_000; i++) {
      queue.enqueue({
        id: `loc-${i}`,
        priority: 'low',
        payload: { seq: i },
        timestamp: now(),
        maxRetries: 1,
      })
    }
    const metrics = queue.getMetrics()
    expect(metrics.low).toBe(5)
    expect(metrics.shed).toBe(5_000 - 5)
    expect(metrics.bounds.low).toBe(5)

    for (let i = 0; i < 500; i++) {
      const result = queue.enqueue({
        id: `p0-${i}`,
        priority: 'P0',
        payload: { seq: i },
        timestamp: now(),
        maxRetries: 1,
      })
      expect(result.accepted).toBe(true)
      expect(result.tier).toBe('P0')
    }
    expect(queue.getMetrics().critical).toBe(500)
    expect(queue.getMetrics().shed).toBe(5_000 - 5) // no P0 was shed
  })

  it('coalesces LocUpd by opaque key, keeping only the newest update', () => {
    const queue = new DispatchQueue({ bounds: { low: 10 }, memoryBudgetItems: 1_000 })
    queue.enqueue({
      id: 'loc-old',
      priority: 'P3',
      coalesceKey: 'tile-42',
      payload: { version: 1 },
      timestamp: now(),
      maxRetries: 1,
    })
    const result = queue.enqueue({
      id: 'loc-new',
      priority: 'P3',
      coalesceKey: 'tile-42',
      payload: { version: 2 },
      timestamp: now(),
      maxRetries: 1,
    })

    expect(result.accepted).toBe(true)
    expect(queue.getMetrics().low).toBe(1)
    expect(queue.getMetrics().coalesced).toBe(1)
    expect(queue.getMetrics().shed).toBe(1)
  })

  it('emits overload and sheds non-P0 when the memory budget is reached', () => {
    const onShed = vi.fn()
    const onOverload = vi.fn()
    const queue = new DispatchQueue({
      bounds: { low: 100 },
      memoryBudgetItems: 2,
      onShed,
      onOverload,
    })
    queue.enqueue({ id: 'a', priority: 'low', payload: {}, timestamp: now(), maxRetries: 1 })
    queue.enqueue({ id: 'b', priority: 'normal', payload: {}, timestamp: now(), maxRetries: 1 })
    expect(onOverload).toHaveBeenCalledTimes(1)

    const shed = queue.enqueue({ id: 'c', priority: 'low', messageType: 'LocUpd', payload: {}, timestamp: now(), maxRetries: 1 })
    expect(shed.accepted).toBe(false)
    expect(shed.reason).toBe('memory_budget')
    expect(onShed).toHaveBeenCalledWith(expect.objectContaining({ tier: 'P3', reason: 'memory_budget' }))

    const critical = queue.enqueue({ id: 'p0', priority: 'P0', payload: {}, timestamp: now(), maxRetries: 1 })
    expect(critical.accepted).toBe(true)
    expect(queue.isOverloaded()).toBe(true)
    expect(queue.getMetrics().overloadEvents).toBe(1)
  })

  it('derives tier from message type only — identity fields have no path to a tier', () => {
    // Pure mapping: no wallet/reputation argument exists.
    expect(priorityForMessage('LocUpd', 'medical')).toBe('low')
    expect(priorityForMessage('RqCreated', 'medical')).toBe('critical')
    expect(priorityForMessage('OfferAccepted')).toBe('high')
    expect(priorityForMessage('OfferMade')).toBe('normal')
    expect(priorityForMessage('StatusChange')).toBe('normal')
    expect(tierForMessage('LocUpd', 'danger')).toBe('P3')

    const identityNoise = {
      wallet: 'GCRITICALWALLETADDRESS123',
      reputation: 99,
      responderRole: 'medical',
      note: 'urgent danger critical medical',
    }
    expect(detectPriority({ headers: {}, body: identityNoise, path: '/api/dispatch/' })).toBe('normal')

    const locUpdWithNoise = {
      headers: {},
      body: { messageType: 'LocUpd', ...identityNoise },
      path: '/api/dispatch/payload/1',
    }
    expect(detectPriority(locUpdWithNoise)).toBe('low')
    expect(toAdr020Tier(detectPriority(locUpdWithNoise))).toBe('P3')

    // Queue enqueue accepts only a priority/tier; payload identity is inert.
    const queue = new DispatchQueue()
    const result = queue.enqueue({
      id: 'x',
      priority: toQueuePriority('low'),
      payload: identityNoise,
      timestamp: now(),
      maxRetries: 1,
    })
    expect(result.tier).toBe('P3')
    expect(queue.getMetrics().low).toBe(1)
    expect(queue.getMetrics().critical).toBe(0)
  })

  it('loads bounds from public/config.json with P0 forced unbounded', () => {
    const config = loadDispatchConfig()
    expect(config.bounds.high).toBe(10_000)
    expect(config.bounds.normal).toBe(5_000)
    expect(config.bounds.low).toBe(1_000)
    expect(config.bounds.critical).toBe(Number.POSITIVE_INFINITY)
    expect(config.memoryBudgetItems).toBeGreaterThan(DEFAULT_DISPATCH_CONFIG.bounds.high)

    const queue = new DispatchQueue({ bounds: config.bounds, memoryBudgetItems: config.memoryBudgetItems })
    expect(queue.getBounds()).toEqual(DEFAULT_DISPATCH_BOUNDS)
  })

  it('returns 503 Overloaded from the HTTP surface and records the shed row', async () => {
    clearDispatchShed()
    const envelope = {
      version: 1,
      algorithm: 'ECDH-P256-HKDF-SHA256+AES-256-GCM',
      bindingContext: 'test',
      ephemeralPublicKey: '04' + '11'.repeat(64),
      iv: '00'.repeat(12),
      authTag: '00'.repeat(16),
      ciphertext: 'ab',
      wrappedKeys: [
        {
          keyId: '00'.repeat(8),
          wrapIv: '00'.repeat(12),
          wrapAuthTag: '00'.repeat(16),
          wrappedKey: '00'.repeat(32),
        },
      ],
    }
    const { api, metrics } = createDispatchRouters({
      store: createMemoryDispatchStore(),
      tickIntervalMs: -1,
      config: {
        ...loadDispatchConfig(),
        memoryBudgetItems: 1,
        bounds: { critical: Infinity, high: 10, normal: 10, low: 10 },
      },
    })
    const app = express().use(express.json()).use('/api/dispatch', api).use('/metrics', metrics)

    const accepted = await request(app)
      .post('/api/dispatch/payload/req-1')
      .send({ envelope })
      .expect(200)
    expect(accepted.status).toBe(200)
    expect(accepted.headers['x-overloaded']).toBe('1')

    const rejected = await request(app)
      .post('/api/dispatch/payload/req-2')
      .send({ envelope })
      .expect(503)
    expect(rejected.body).toMatchObject({ error: 'Overloaded', code: 'overloaded' })
    expect(Number(rejected.headers['retry-after'])).toBeGreaterThan(0)

    const metricText = await request(app).get('/metrics/dispatch').expect(200)
    expect(metricText.text).toContain('helphone_dispatch_overloaded 1')

    const audit = await latestDispatchShed(5)
    expect(audit.some((row) => row.payload.reason === 'memory_budget')).toBe(true)
  })

  it('exposes bounds and overload state on the queue metrics endpoint', async () => {
    const { api } = createDispatchRouters({
      config: {
        ...loadDispatchConfig(),
        bounds: { critical: Infinity, high: 7, normal: 6, low: 5 },
        memoryBudgetItems: 50,
      },
    })
    const app = express().use('/api/dispatch', api)
    const response = await request(app).get('/api/dispatch/queue/metrics').expect(200)
    expect(response.body.bounds).toMatchObject({ high: 7, normal: 6, low: 5 })
    expect(response.body.memoryBudget).toBe(50)
    expect(response.body.overloaded).toBe(false)
  })
})
