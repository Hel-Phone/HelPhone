// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createTrustBundle, signFederatedEnvelope } from '../src/lib/crypto.js'
import { createFederationRouter, resolveSheddingPolicy } from '../server/routes/federation.js'
import { clearDispatchShed, latestDispatchShed } from '../server/indexer/auditStreamer.js'

const A = {
  id: 'helphone-city-a',
  domain: 'city-a.helphone.org',
  secretKey: '11'.repeat(32),
  publicKey: '04' + '22'.repeat(64),
  root: '0xae91500000000000000000000000000000000000000000000000000000000001',
  expert: '0xexp0000000000000000000000000000000000000000000000000000000000001',
}
const B = {
  id: 'helphone-city-b',
  domain: 'city-b.helphone.org',
  secretKey: '33'.repeat(32),
  publicKey: '04' + '44'.repeat(64),
  root: '0xae91500000000000000000000000000000000000000000000000000000000002',
  expert: '0xexp0000000000000000000000000000000000000000000000000000000000002',
}

function appFor(instance) {
  const app = express()
  app.use(express.json())
  app.use('/federation', createFederationRouter({ instanceId: instance.id, domain: instance.domain }))
  return app
}

async function bundleOf(instance, { rotationCounter = 1, revokedIdentities = [] } = {}) {
  return createTrustBundle({
    instanceId: instance.id,
    domain: instance.domain,
    aegisVaultRoot: instance.root,
    rotationCounter,
    expertRegistryHash: instance.expert,
    revokedIdentities,
    secretKey: instance.secretKey,
    publicKey: instance.publicKey,
  })
}

function envelope(from, to, { payloadType = 'dispatch', payload, rotationCounter = 1, nonce } = {}) {
  return signFederatedEnvelope({
    senderInstance: from.id,
    recipientInstance: to.id,
    payloadType,
    payload,
    trustBundleRef: { instanceId: from.id, rotationCounter },
    secretKey: from.secretKey,
    publicKey: from.publicKey,
    nonce: nonce ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  })
}

let appA
let appB

beforeEach(async () => {
  clearDispatchShed()
  appA = appFor(A)
  appB = appFor(B)
  const bundleA = await bundleOf(A)
  const bundleB = await bundleOf(B)
  await request(appB).post('/federation/trust-bundle/gossip').send({ trustBundle: bundleA }).expect(200)
  await request(appA).post('/federation/trust-bundle/gossip').send({ trustBundle: bundleB }).expect(200)
})

describe('ADR-018/020 federation — trust on every receive and consistent shedding', () => {
  it('stops accepting an in-flight message within one rotation cycle of revocation', async () => {
    const rogue = 'rogue-volunteer-99'
    const inFlight = await envelope(A, B, {
      payload: { incidentId: 'inc-99', responder: rogue, type: 'medical' },
    })
    await request(appB).post('/federation/dispatch').send({ envelope: inFlight }).expect(200)

    // A rotates its trust root and adds the revocation; B gossips the new bundle.
    await request(appA).post('/federation/test/revoke-identity').send({ identity: rogue }).expect(200)
    const rotated = await request(appA).get('/federation/trust-bundle').expect(200)
    expect(rotated.body.trustBundle.rotationCounter).toBe(2)
    expect(rotated.body.trustBundle.revokedIdentities).toContain(rogue)
    await request(appB)
      .post('/federation/trust-bundle/gossip')
      .send({ trustBundle: rotated.body.trustBundle })
      .expect(200)

    // The old in-flight envelope is now rejected: its counter is superseded.
    const stale = await request(appB).post('/federation/dispatch').send({ envelope: inFlight })
    expect(stale.status).toBe(403)
    expect(stale.body.error).toMatch(/superseded|revoked/i)

    // A freshly signed envelope for the revoked identity is rejected by revocation.
    const revokedNow = await envelope(A, B, {
      rotationCounter: 2,
      payload: { incidentId: 'inc-100', responder: rogue, type: 'medical' },
    })
    const denied = await request(appB).post('/federation/dispatch').send({ envelope: revokedNow })
    expect(denied.status).toBe(403)
    expect(denied.body.error).toContain('revoked')

    // A clean responder still works under the rotated bundle.
    const clean = await envelope(A, B, {
      rotationCounter: 2,
      payload: { incidentId: 'inc-101', responder: 'clean-volunteer', type: 'medical' },
    })
    await request(appB).post('/federation/dispatch').send({ envelope: clean }).expect(200)
  })

  it('two overloaded nodes agree to shed locally and do not gossip a feedback storm', async () => {
    // Both peers publish their overload state to each other.
    const overloadA = await envelope(A, B, {
      payloadType: 'overload',
      payload: { shedding: true, rotationCounter: 1, at: Date.now() },
    })
    const overloadB = await envelope(B, A, {
      payloadType: 'overload',
      payload: { shedding: true, rotationCounter: 1, at: Date.now() },
    })
    await request(appB).post('/federation/overload').send({ envelope: overloadA }).expect(200)
    await request(appA).post('/federation/overload').send({ envelope: overloadB }).expect(200)
    await request(appA).post('/federation/test/overload').send({ overloaded: true }).expect(200)
    await request(appB).post('/federation/test/overload').send({ overloaded: true }).expect(200)

    const statusA = await request(appA).get('/federation/status').expect(200)
    const statusB = await request(appB).get('/federation/status').expect(200)
    expect(statusA.body.sheddingPolicy).toBe('both_overloaded_local_shed')
    expect(statusB.body.sheddingPolicy).toBe('both_overloaded_local_shed')
    expect(statusB.body.peerShedding).toEqual(
      expect.arrayContaining([expect.objectContaining({ instance: A.id, shedding: true })]),
    )

    const gossipedBefore = statusB.body.gossipCount
    const routine = await envelope(A, B, {
      payload: { incidentId: 'inc-shed', responder: 'volunteer-1', type: 'lost' },
    })
    const shed = await request(appB).post('/federation/dispatch').send({ envelope: routine })
    expect(shed.status).toBe(503)
    expect(shed.body.error).toBe('Overloaded')
    expect(shed.body.sheddingPolicy).toBe('both_overloaded_local_shed')
    expect(Number(shed.headers['retry-after'])).toBeGreaterThan(0)

    // P0 is never shed, even at both nodes under overload.
    const critical = await envelope(A, B, {
      payload: { incidentId: 'inc-critical', responder: 'volunteer-1', type: 'medical' },
    })
    await request(appB).post('/federation/dispatch').send({ envelope: critical }).expect(200)

    // No gossip feedback loop when both nodes already know the other is shedding.
    const statusAfter = await request(appB).get('/federation/status').expect(200)
    expect(statusAfter.body.gossipCount).toBe(gossipedBefore)

    const audit = await latestDispatchShed(10)
    expect(audit.length).toBeGreaterThan(0)
    expect(audit.some((row) => row.payload.reason === 'overloaded')).toBe(true)
  })

  it('gossips a signed shed signal when only the local node is overloaded', async () => {
    const result = await request(appA)
      .post('/federation/test/overload')
      .send({ overloaded: true, gossip: true })
      .expect(200)
    expect(result.body.gossiped).toBe(true)
    expect(result.body.policy).toBe('local_overload_gossip')
    const status = await request(appA).get('/federation/overload').expect(200)
    expect(status.body.gossipCount).toBeGreaterThan(0)
    expect(status.body.overloaded).toBe(true)
  })

  it('pure policy covers all four two-node states', () => {
    expect(resolveSheddingPolicy(true, false)).toEqual({
      shedLocally: true,
      gossip: true,
      reason: 'local_overload_gossip',
    })
    expect(resolveSheddingPolicy(true, true).gossip).toBe(false)
    expect(resolveSheddingPolicy(false, true).reason).toBe('peer_overload_honoured')
    expect(resolveSheddingPolicy(false, false).reason).toBe('nominal')
  })
})
