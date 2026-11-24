/**
 * Server-side dispatch queue priority management.
 * Prevents urgent requests from starving under stale update loads.
 * Integrates with dispatch.ts envelope relay.
 *
 * ADR-020 §Decision 1: priority comes from the MESSAGE TYPE only. Wallet
 * identity, responder role and reputation score are never consulted — there
 * is deliberately no code path from those fields to a queue tier.
 */

import type { Request, Response, NextFunction } from 'express'
import { toAdr020Tier, toQueuePriority, type Adr020Tier, type DispatchPriority } from '../../src/lib/dispatchQueue.ts'

export interface PriorityContext {
  requestId: string
  priority: DispatchPriority
  tier: Adr020Tier
  timestamp: number
  isUpdate: boolean
  messageType: string
}

/** Message types handled by server/routes/dispatch.ts (ADR-020 Option B). */
export const DISPATCH_MESSAGE_TYPES = ['RqCreated', 'LocUpd', 'OfferMade', 'OfferAccepted', 'StatusChange'] as const
export type DispatchMessageType = (typeof DISPATCH_MESSAGE_TYPES)[number]

/** RqCreated incident types treated as life-critical (P0) / urgent (P1). */
const CRITICAL_INCIDENT_TYPES = new Set(['medical', 'danger', 'critical'])
const URGENT_INCIDENT_TYPES = new Set(['lost', 'fallen', 'urgent', 'high'])

function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * Pure tier mapping. No identity or reputation argument exists by design.
 * `messageType` is the dispatch protocol message type; `incidentType` is the
 * requester-declared severity on an RqCreated message.
 */
export function priorityForMessage(messageType?: string | null, incidentType?: string | null): DispatchPriority {
  const message = normalized(messageType)
  const incident = normalized(incidentType)

  if (message === 'locupd') return 'low'
  if (message === 'offeraccepted') return 'high'
  if (message === 'offermade' || message === 'statuschange') return 'normal'

  if (message === 'rqcreated' || (!message && incident)) {
    if (CRITICAL_INCIDENT_TYPES.has(incident)) return 'critical'
    if (URGENT_INCIDENT_TYPES.has(incident)) return 'high'
    return 'normal'
  }

  // Declared REST severity (createIncidentSchema.priority) is also a message
  // attribute, not an identity attribute.
  return toQueuePriority(incident || null)
}

/** ADR-020 tier for a dispatch message type pair. */
export function tierForMessage(messageType?: string | null, incidentType?: string | null): Adr020Tier {
  return toAdr020Tier(priorityForMessage(messageType, incidentType))
}

function messageTypeOf(req: Request): string {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const candidates = [body.messageType, body.eventType, body.type, req.headers['x-message-type']]
  for (const candidate of candidates) {
    const value = normalized(candidate)
    const match = DISPATCH_MESSAGE_TYPES.find((type) => type.toLowerCase() === value)
    if (match) return match
  }
  return ''
}

function incidentTypeOf(req: Request, messageType: string): string {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  // On RqCreated the protocol field is `type`; nested payloads use
  // `incidentType`/`requestType`. Identity fields (wallet, responder,
  // reputation, notes) are intentionally never read.
  if (messageType === 'rqcreated' || !messageType) {
    for (const candidate of [body.incidentType, body.requestType, body.type, body.priority]) {
      const value = normalized(candidate)
      if (value && !normalized(body.messageType)) return value
    }
  }
  return normalized(body.priority)
}

/**
 * Detect priority from message semantics and optional X-Priority header.
 * `X-Priority` is an explicit protocol hint and maps through the same
 * type-only tier table.
 */
export function detectPriority(req: Request): DispatchPriority {
  const header = normalized(req.headers['x-priority'])
  if (
    header === 'critical' ||
    header === 'p0' ||
    header === 'high' ||
    header === 'p1' ||
    header === 'normal' ||
    header === 'p2' ||
    header === 'low' ||
    header === 'p3'
  ) {
    return toQueuePriority(header)
  }

  const messageType = messageTypeOf(req)
  return priorityForMessage(messageType, incidentTypeOf(req, messageType))
}

/**
 * Determine if a request is a status update (vs. new dispatch).
 * Updates are deprioritized if critical requests are pending.
 */
export function isStaleUpdate(req: Request): boolean {
  const method = req.method.toUpperCase()
  if (method !== 'POST' && method !== 'PUT') return false

  const body = req.body || {}
  const isStatusChange = 'status' in body || 'state' in body || 'update' in body
  const age = Date.now() - ((body.timestamp as number) ?? 0)

  return isStatusChange && age > 5_000
}

/** Middleware attaching priority context to requests. */
export function createDispatchPriorityMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const priority = detectPriority(req)
    const tier = toAdr020Tier(priority)
    const isUpdate = isStaleUpdate(req)

    ;(req as any).priorityContext = {
      requestId: req.path,
      messageType: messageTypeOf(req),
      priority,
      tier,
      timestamp: Date.now(),
      isUpdate,
    } as PriorityContext

    next()
  }
}

/** Attach priority context to request object for downstream middleware. */
declare global {
  namespace Express {
    interface Request {
      priorityContext?: PriorityContext
    }
  }
}
