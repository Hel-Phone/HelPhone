/**
 * Federation Protocol v0 Route Handler (ISP-144)
 *
 * Implements cross-instance dispatch, trust-bundle gossip, mutual authentication,
 * CRDT delta exchange, and IOU aid settlement without a central server.
 *
 * ADR-018 follow-up: overload handling is decided explicitly (local shed vs
 * gossip). ADR-020 follow-up: shed decisions are reported with 503 Overloaded
 * and written to the dispatch audit stream. Every inbound message is checked
 * against the originating instance's CURRENT trust bundle (signature, freshness,
 * rotation counter and revocations) on every receive.
 */
import { Router, Request, Response } from 'express'
import { federationVersionNegotiationMiddleware } from '../middleware/apiVersion.ts'
import {
  createTrustBundle,
  verifyTrustBundle,
  signFederatedEnvelope,
  verifyFederatedEnvelope,
  isIdentityRevoked,
} from '../../src/lib/crypto.js'
import type { TrustBundle, FederatedEnvelope } from '../../src/lib/crypto.js'
import { ReplayCache } from '../../src/lib/wsClient.js'
import { parseFederatedEvent } from '../indexer/parser.js'
import { recordHistoryEvent } from './history.js'
import { localCrdtStore } from './sync.js'
import { recordDispatchShed } from '../indexer/auditStreamer.js'
import {
  issueCrossInstanceIou,
  netCrossInstanceIous,
  escalateUnpaidIouToDao,
} from '../../src/lib/treasury.js'
import type { CrossInstanceIou } from '../../src/lib/treasury.js'

export interface FederationRouterOptions {
  instanceId?: string
  domain?: string
  aegisVaultRoot?: string
  secretKey?: string
  publicKey?: string
  rotationCounter?: number
  /** Live load signal for the local node (chaos drills inject this). */
  isOverloaded?: () => boolean
  /** peer instanceId -> overload ingestion URL, used to gossip shed signals. */
  peerUrls?: Record<string, string>
  /** Injectable transport for tests. */
  gossipFetch?: typeof fetch
}

export interface SheddingPolicy {
  shedLocally: boolean
  gossip: boolean
  reason: 'nominal' | 'local_overload_gossip' | 'both_overloaded_local_shed' | 'peer_overload_honoured'
}

/**
 * Two-node consistency rule:
 *  - Only I am overloaded  -> shed locally AND gossip so the peer also backs off.
 *  - Both overloaded       -> both shed locally; no gossip storm.
 *  - Only peer overloaded  -> honour its signal and shed locally.
 *  - Neither overloaded    -> process normally.
 * P0 (life-critical) is exempt from shedding in all cases.
 */
export function resolveSheddingPolicy(localOverloaded: boolean, peerShedding: boolean): SheddingPolicy {
  if (localOverloaded && !peerShedding) {
    return { shedLocally: true, gossip: true, reason: 'local_overload_gossip' }
  }
  if (localOverloaded && peerShedding) {
    return { shedLocally: true, gossip: false, reason: 'both_overloaded_local_shed' }
  }
  if (peerShedding) {
    return { shedLocally: true, gossip: false, reason: 'peer_overload_honoured' }
  }
  return { shedLocally: false, gossip: false, reason: 'nominal' }
}

/** ADR-020 P0 messages are never shed across a federation boundary. */
export function isLifeCriticalEnvelope(envelope: FederatedEnvelope): boolean {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>
  return ['medical', 'danger', 'critical', 'p0'].some((value) => {
    return (
      String(payload.type ?? '').toLowerCase() === value ||
      String(payload.priority ?? '').toLowerCase() === value ||
      String(payload.severity ?? '').toLowerCase() === value
    )
  })
}

const REVOCATION_IDENTITY_FIELDS = [
  'responder',
  'responderAddress',
  'responderId',
  'nullifier',
  'actor',
  'signer',
  'wallet',
]

/** Find the first payload identity revoked by the peer's current bundle. */
export function revokedIdentityIn(envelope: FederatedEnvelope, bundle: TrustBundle): string | null {
  const payload = (envelope.payload ?? {}) as Record<string, unknown>
  for (const field of REVOCATION_IDENTITY_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string' && value && isIdentityRevoked(value, bundle)) return value
  }
  return null
}

interface AuthorizedInbound {
  peerBundle: TrustBundle
  staleBundleFlag?: boolean
}

interface RejectedInbound {
  status: number
  error: string
}

export function createFederationRouter(options: FederationRouterOptions = {}) {
  const router = Router()
  router.use(federationVersionNegotiationMiddleware())

  const instanceId = options.instanceId || process.env.INSTANCE_ID || 'helphone-instance-a'
  const domain = options.domain || process.env.FEDERATION_DOMAIN || 'instance-a.helphone.org'
  let aegisVaultRoot = options.aegisVaultRoot || '0xae91500000000000000000000000000000000000000000000000000000000001'
  let rotationCounter = options.rotationCounter ?? 1
  const expertRegistryHash = '0xexp7890000000000000000000000000000000000000000000000000000000001'
  const localRevocations = new Set<string>()

  // Per-router state: two nodes can be simulated in one process (chaos tests).
  const peerTrustBundles = new Map<string, TrustBundle>()
  const peerLoadSignals = new Map<
    string,
    { shedding: boolean; rotationCounter: number; receivedAt: number; envelopeId: string }
  >()
  const gossipLog: FederatedEnvelope[] = []
  const shedAuditLog: Array<{ at: number; tier: string; reason: string; instance: string }> = []
  const replayCache = new ReplayCache(300_000)
  const iouStore = new Map<string, CrossInstanceIou>()
  const revocationAuditLog: Array<{ identity: string; revokedAt: number; sourceInstance: string }> = []
  let localOverloaded = false

  // Deterministic local authority keypair fallback for testing
  const secretKey = options.secretKey || process.env.FEDERATION_SECRET_KEY || '11'.repeat(32)
  const publicKey = options.publicKey || process.env.FEDERATION_PUBLIC_KEY || '04' + '22'.repeat(64)

  function currentOverload(): boolean {
    return options.isOverloaded?.() ?? localOverloaded
  }

  async function getLocalTrustBundle(): Promise<TrustBundle> {
    return createTrustBundle({
      instanceId,
      domain,
      aegisVaultRoot,
      rotationCounter,
      expertRegistryHash,
      revokedIdentities: [...localRevocations],
      secretKey,
      publicKey,
      ttlMs: 3600_000,
    })
  }

  /**
   * Re-verify every inbound envelope against the CURRENT peer bundle. No
   * per-peer verification result is cached: a revocation gossiped one instant
   * ago is effective on the very next receive.
   */
  function authorizeInbound(
    envelope: FederatedEnvelope,
    { checkReplay = true }: { checkReplay?: boolean } = {},
  ): AuthorizedInbound | RejectedInbound {
    if (!envelope || typeof envelope !== 'object') {
      return { status: 400, error: 'Missing federated envelope' }
    }
    const peerBundle = peerTrustBundles.get(envelope.senderInstance)
    if (!peerBundle) {
      return {
        status: 403,
        error: `Untrusted peer instance '${envelope.senderInstance}': no trust bundle on record`,
      }
    }

    const bundleCheck = verifyTrustBundle(peerBundle, envelope.senderPublicKey)
    if (!bundleCheck.valid) {
      return { status: 403, error: `Current peer trust bundle is not valid: ${bundleCheck.error}` }
    }

    if (
      !envelope.trustBundleRef ||
      envelope.trustBundleRef.instanceId !== envelope.senderInstance ||
      envelope.trustBundleRef.rotationCounter < peerBundle.rotationCounter
    ) {
      return {
        status: 403,
        error: `Envelope references superseded trust root counter ${envelope.trustBundleRef?.rotationCounter} < ${peerBundle.rotationCounter}`,
      }
    }

    const verifyOutcome = verifyFederatedEnvelope(envelope, peerBundle)
    if (!verifyOutcome.verified) {
      return { status: 401, error: `Envelope verification failed: ${verifyOutcome.error}` }
    }

    const revoked = revokedIdentityIn(envelope, peerBundle)
    if (revoked) {
      return {
        status: 403,
        error: `Identity '${revoked}' has been revoked by peer instance ${peerBundle.instanceId}`,
      }
    }

    if (checkReplay && !replayCache.checkAndAdd(envelope.nonce, envelope.timestamp)) {
      return { status: 409, error: `Replay detected: duplicate nonce '${envelope.nonce}' or expired replay window` }
    }

    return { peerBundle, staleBundleFlag: verifyOutcome.staleBundle }
  }

  async function signAck(original: FederatedEnvelope, payload: Record<string, unknown>) {
    const localBundle = await getLocalTrustBundle()
    return signFederatedEnvelope({
      senderInstance: instanceId,
      recipientInstance: original.senderInstance,
      payloadType: 'ack' as const,
      payload,
      trustBundleRef: { instanceId, rotationCounter: localBundle.rotationCounter },
      secretKey,
      publicKey,
    })
  }

  /** Broadcast a signed shed signal (ADR-018 gossip path). */
  async function gossipShedSignal(targetInstance?: string): Promise<FederatedEnvelope> {
    const localBundle = await getLocalTrustBundle()
    const envelope = await signFederatedEnvelope({
      senderInstance: instanceId,
      recipientInstance: targetInstance ?? 'federation-peers',
      payloadType: 'overload' as const,
      payload: {
        shedding: true,
        rotationCounter: localBundle.rotationCounter,
        at: Date.now(),
      },
      trustBundleRef: { instanceId, rotationCounter: localBundle.rotationCounter },
      secretKey,
      publicKey,
    })
    gossipLog.push(envelope)

    const targets = targetInstance ? [targetInstance] : Object.keys(options.peerUrls ?? {})
    const transport = options.gossipFetch ?? fetch
    for (const target of targets) {
      const url = options.peerUrls?.[target]
      if (!url) continue
      try {
        await transport(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ envelope }),
          signal: AbortSignal.timeout(2_000),
        })
      } catch {
        // Gossip is best-effort; the local shed decision still stands.
      }
    }
    return envelope
  }

  function recordLocalShed(envelope: FederatedEnvelope, reason: string): void {
    shedAuditLog.push({ at: Date.now(), tier: isLifeCriticalEnvelope(envelope) ? 'P0' : 'P2', reason, instance: instanceId })
    void recordDispatchShed({
      tier: isLifeCriticalEnvelope(envelope) ? 'P0' : 'P2',
      reason: 'overloaded',
      messageType: envelope.payloadType,
    })
  }

  function sheddingFor(envelope: FederatedEnvelope): SheddingPolicy {
    const peerShedding = peerLoadSignals.get(envelope.senderInstance)?.shedding ?? false
    const policy = resolveSheddingPolicy(currentOverload(), peerShedding)
    if (policy.gossip) void gossipShedSignal(envelope.senderInstance)
    return policy
  }

  function overloadedResponse(res: Response, policy: SheddingPolicy) {
    res.set('Retry-After', '5')
    return res.status(503).json({
      success: false,
      error: 'Overloaded',
      code: 'overloaded',
      sheddingPolicy: policy.reason,
    })
  }

  // ── 1. Trust Bundle Export & Gossip Endpoints ─────────────────────────

  router.get('/trust-bundle', async (_req: Request, res: Response) => {
    try {
      const bundle = await getLocalTrustBundle()
      res.json({ success: true, trustBundle: bundle })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  router.post('/trust-bundle/gossip', async (req: Request, res: Response) => {
    try {
      const incomingBundle: TrustBundle = req.body?.trustBundle
      if (!incomingBundle || !incomingBundle.instanceId) {
        return res.status(400).json({ success: false, error: 'Missing or malformed trustBundle' })
      }

      const existing = peerTrustBundles.get(incomingBundle.instanceId)
      if (existing && incomingBundle.rotationCounter < existing.rotationCounter) {
        return res.status(409).json({
          success: false,
          error: `Stale rotation counter: received ${incomingBundle.rotationCounter}, have ${existing.rotationCounter}`,
        })
      }

      const verification = verifyTrustBundle(incomingBundle, incomingBundle.signingPublicKey)
      if (!verification.valid) {
        return res.status(403).json({ success: false, error: verification.error })
      }

      const prevRevoked = new Set(existing?.revokedIdentities || [])
      for (const rev of incomingBundle.revokedIdentities || []) {
        if (!prevRevoked.has(rev)) {
          revocationAuditLog.push({
            identity: rev,
            revokedAt: Date.now(),
            sourceInstance: incomingBundle.instanceId,
          })
        }
      }

      // Replace atomically: the next receive sees the new counter + revocations.
      peerTrustBundles.set(incomingBundle.instanceId, incomingBundle)

      res.json({
        success: true,
        message: 'Trust bundle accepted and stored',
        instanceId: incomingBundle.instanceId,
        rotationCounter: incomingBundle.rotationCounter,
        staleWarning: verification.stale,
      })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ── 2. Cross-Instance Dispatch & Acknowledgement ──────────────────────

  router.post('/dispatch', async (req: Request, res: Response) => {
    try {
      const envelope: FederatedEnvelope = req.body?.envelope
      const auth = authorizeInbound(envelope)
      if ('status' in auth) {
        if (envelope) {
          recordHistoryEvent(parseFederatedEvent(envelope, { verified: false, error: auth.error }))
        }
        return res.status(auth.status).json({ success: false, error: auth.error })
      }

      const policy = sheddingFor(envelope)
      if (policy.shedLocally && !isLifeCriticalEnvelope(envelope)) {
        recordLocalShed(envelope, policy.reason)
        return overloadedResponse(res, policy)
      }

      recordHistoryEvent(parseFederatedEvent(envelope, { verified: true }))
      const ackEnvelope = await signAck(envelope, {
        originalEnvelopeId: envelope.envelopeId,
        incidentId: envelope.payload?.incidentId || envelope.payload?.id,
        status: 'acknowledged',
        responderAssigned: envelope.payload?.responder || envelope.payload?.responderAddress || 'local-volunteer',
        acknowledgedAt: Date.now(),
      })

      res.json({
        success: true,
        message: 'Federated dispatch accepted and verified',
        staleBundleFlag: auth.staleBundleFlag,
        sheddingPolicy: policy.reason,
        ackEnvelope,
      })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  router.post('/ack', async (req: Request, res: Response) => {
    try {
      const envelope: FederatedEnvelope = req.body?.envelope
      const auth = authorizeInbound(envelope)
      if ('status' in auth) {
        if (envelope) {
          recordHistoryEvent(parseFederatedEvent(envelope, { verified: false, error: auth.error }))
        }
        return res.status(auth.status).json({ success: false, error: auth.error })
      }

      const policy = sheddingFor(envelope)
      if (policy.shedLocally && !isLifeCriticalEnvelope(envelope)) {
        recordLocalShed(envelope, policy.reason)
        return overloadedResponse(res, policy)
      }

      recordHistoryEvent(parseFederatedEvent(envelope, { verified: true }))
      res.json({
        success: true,
        message: 'Cross-instance acknowledgement observed and verified',
        staleBundleFlag: auth.staleBundleFlag,
        sheddingPolicy: policy.reason,
      })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ── 3. CRDT Peer Delta Exchange ───────────────────────────────────────

  router.post('/sync', async (req: Request, res: Response) => {
    try {
      const envelope: FederatedEnvelope = req.body?.envelope
      if (!envelope || envelope.payloadType !== 'crdt_delta') {
        return res.status(400).json({ success: false, error: 'Invalid or missing crdt_delta envelope' })
      }
      const auth = authorizeInbound(envelope)
      if ('status' in auth) {
        return res.status(auth.status).json({ success: false, error: auth.error })
      }

      const policy = sheddingFor(envelope)
      if (policy.shedLocally && !isLifeCriticalEnvelope(envelope)) {
        recordLocalShed(envelope, policy.reason)
        return overloadedResponse(res, policy)
      }

      const operations = envelope.payload?.operations || []
      let applied = 0
      for (const op of operations) {
        const namespaced = {
          ...op,
          instance: envelope.senderInstance,
          provenance: 'peer_asserted' as const,
        }
        if (localCrdtStore.apply(namespaced)) {
          applied++
        }
      }

      const localClock = localCrdtStore.clock
      const returnDeltas = localCrdtStore.delta(envelope.payload?.vectorClock || {})
      const localBundle = await getLocalTrustBundle()
      const responseEnvelope = await signFederatedEnvelope({
        senderInstance: instanceId,
        recipientInstance: envelope.senderInstance,
        payloadType: 'crdt_delta',
        payload: {
          operations: returnDeltas,
          vectorClock: localClock,
        },
        trustBundleRef: { instanceId, rotationCounter: localBundle.rotationCounter },
        secretKey,
        publicKey,
      })

      res.json({ success: true, appliedCount: applied, responseEnvelope })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ── 4. Cross-Instance Settlement & IOU Netting ────────────────────────

  router.post('/settlement', async (req: Request, res: Response) => {
    try {
      const { action, incidentId, debtorInstance, creditorInstance, stroops, defaultReason } = req.body || {}

      if (action === 'issue') {
        if (!incidentId || !debtorInstance || !creditorInstance || !stroops) {
          return res.status(400).json({ success: false, error: 'Missing IOU creation fields' })
        }
        const iou = issueCrossInstanceIou({
          incidentId,
          debtorInstance,
          creditorInstance,
          stroops: Number(stroops),
        })
        iouStore.set(iou.iouId, iou)
        return res.json({ success: true, message: 'Cross-instance IOU issued', iou })
      }

      if (action === 'net') {
        const ious = [...iouStore.values()]
        const { netResult, updatedIous } = netCrossInstanceIous(
          ious,
          debtorInstance || instanceId,
          creditorInstance || 'peer'
        )
        for (const u of updatedIous) {
          iouStore.set(u.iou.iouId, u)
        }
        return res.json({ success: true, netResult, remainingIous: updatedIous })
      }

      if (action === 'escalate_default') {
        const iou = iouStore.get(req.body?.iouId)
        if (!iou) {
          return res.status(404).json({ success: false, error: 'IOU not found' })
        }
        const escalation = escalateUnpaidIouToDao(iou, defaultReason)
        iouStore.set(escalation.iou.iouId, escalation.iou)
        return res.json({ success: true, message: 'Defaulted IOU escalated to DAO proposal', escalation })
      }

      res.status(400).json({ success: false, error: `Unknown action: ${action}` })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  // ── 5. Overload Gossip & Shedding Control ──────────────────────────────

  /** Receive a signed shed signal from a peer. Same trust checks as any receive. */
  router.post('/overload', async (req: Request, res: Response) => {
    try {
      const envelope: FederatedEnvelope = req.body?.envelope
      if (!envelope || envelope.payloadType !== 'overload') {
        return res.status(400).json({ success: false, error: 'Invalid or missing overload envelope' })
      }
      const auth = authorizeInbound(envelope)
      if ('status' in auth) {
        return res.status(auth.status).json({ success: false, error: auth.error })
      }

      peerLoadSignals.set(envelope.senderInstance, {
        shedding: Boolean(envelope.payload?.shedding),
        rotationCounter: envelope.trustBundleRef.rotationCounter,
        receivedAt: Date.now(),
        envelopeId: envelope.envelopeId,
      })
      void recordDispatchShed({ tier: 'P2', reason: 'peer_shed_signal', messageType: 'overload' })

      const policy = resolveSheddingPolicy(currentOverload(), Boolean(envelope.payload?.shedding))
      if (policy.gossip) void gossipShedSignal(envelope.senderInstance)
      const ackEnvelope = await signAck(envelope, {
        originalEnvelopeId: envelope.envelopeId,
        shedding: Boolean(envelope.payload?.shedding),
        acknowledgedAt: Date.now(),
      })
      res.json({ success: true, sheddingPolicy: policy.reason, ackEnvelope })
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message })
    }
  })

  router.get('/overload', (_req: Request, res: Response) => {
    res.json({
      instanceId,
      overloaded: currentOverload(),
      peerSignals: [...peerLoadSignals.entries()].map(([instance, signal]) => ({ instance, ...signal })),
      gossipCount: gossipLog.length,
      shedCount: shedAuditLog.length,
    })
  })

  // ── 6. Federation Status & Maintenance ─────────────────────────────────

  router.get('/status', async (_req: Request, res: Response) => {
    res.json({
      instanceId,
      domain,
      aegisVaultRoot,
      rotationCounter,
      activePeerTrustBundles: [...peerTrustBundles.keys()].map((k) => ({
        instanceId: k,
        rotationCounter: peerTrustBundles.get(k)?.rotationCounter,
        expiresAt: peerTrustBundles.get(k)?.expiresAt,
        revokedCount: peerTrustBundles.get(k)?.revokedIdentities.length || 0,
      })),
      replayCacheEntries: replayCache.size(),
      activeIousCount: [...iouStore.values()].filter((i) => i.status === 'issued').length,
      revocationAuditCount: revocationAuditLog.length,
      overloaded: currentOverload(),
      peerShedding: [...peerLoadSignals.entries()].map(([instance, signal]) => ({
        instance,
        shedding: signal.shedding,
      })),
      sheddingPolicy: resolveSheddingPolicy(
        currentOverload(),
        [...peerLoadSignals.values()].some((signal) => signal.shedding),
      ).reason,
      gossipCount: gossipLog.length,
      shedAuditCount: shedAuditLog.length,
    })
  })

  // Helper for test drills: rotate local trust root
  router.post('/test/rotate-root', (req: Request, res: Response) => {
    rotationCounter++
    if (req.body?.newRoot) {
      aegisVaultRoot = req.body.newRoot
    }
    res.json({ success: true, rotationCounter, aegisVaultRoot })
  })

  // Helper for test drills: revoke identity locally
  router.post('/test/revoke-identity', (req: Request, res: Response) => {
    const { identity } = req.body || {}
    if (!identity) {
      return res.status(400).json({ error: 'identity required' })
    }
    if (!localRevocations.has(identity)) {
      // A revocation changes trust state: rotate the counter so in-flight
      // envelopes signed under the previous root are superseded too.
      localRevocations.add(identity)
      rotationCounter++
    }
    res.json({ success: true, rotationCounter, revokedCount: localRevocations.size })
  })

  // Chaos helper: toggle overload without a real 5,000-connection surge.
  router.post('/test/overload', async (req: Request, res: Response) => {
    localOverloaded = Boolean(req.body?.overloaded)
    let gossiped = false
    if (localOverloaded && req.body?.gossip) {
      await gossipShedSignal(req.body?.targetInstance)
      gossiped = true
    }
    res.json({
      success: true,
      overloaded: localOverloaded,
      gossiped,
      policy: resolveSheddingPolicy(
        localOverloaded,
        [...peerLoadSignals.values()].some((signal) => signal.shedding),
      ).reason,
    })
  })

  return router
}

export default createFederationRouter
