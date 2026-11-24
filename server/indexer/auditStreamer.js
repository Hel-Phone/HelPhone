import { extractTrace, hopAttributes, hopContext, parseTraceparent } from "../lib/traceContext.js";
import { attributionFor } from "./auditAttribution.js";

// Raw identifiers that must not survive into an attributed audit row (#926).
const IDENTITY_KEYS = ["actor", "signer", "userId", "user", "sub", "deviceId", "device_id"];

export function normalizeContractEvent(
  event,
  { source = "soroban", observedAt = new Date().toISOString(), attributionSecret = null } = {},
) {
  const id = event.id || event.pagingToken || `${event.ledger || "unknown"}:${event.txHash || event.transactionHash || "unknown"}:${event.topic || "event"}`;
  const traceparent = traceparentOf(event);
  // The indexer is a fan-out receiver: it keeps the submit/publish span as a
  // link and gives the audit row its own child span id. Without a carrier
  // neither is created, so an untraced ledger poll never starts a trace.
  const hop = hopContext(traceparent, event.trace?.links);
  // With an attribution secret, raw user identity is replaced by a daily hash.
  // Without one, the legacy `actor` field is kept as before.
  const attributed = attributionSecret !== null && attributionSecret !== undefined;
  const rawPayload = event.payload || event.value || event;
  return {
    id,
    source,
    observedAt,
    ledger: event.ledger || event.ledgerClosedAt || null,
    contractId: event.contractId || event.contract || null,
    type: event.type || event.topic || "contract_event",
    txHash: event.txHash || event.transactionHash || null,
    actor: attributed ? null : event.actor || event.signer || null,
    attribution: attributed ? attributionFor(event, { secret: attributionSecret, observedAt }) : null,
    payload: attributed ? withoutIdentity(rawPayload) : rawPayload,
    // #791: join key back to the submitting trace. Comes from the event's
    // `trace` envelope, or from a `traceparent` recorded off-chain at submit
    // time (Soroban itself carries no trace context). Absent → null, never a
    // fresh poll-time trace.
    traceparent,
    spanId: hop?.spanId ?? null,
    links: hop?.links ?? [],
    attributes: hopAttributes({
      dispatchId: event.dispatchId ?? event.requestId,
      txHash: event.txHash || event.transactionHash,
      ledgerSeq: event.ledger,
    }),
  };
}

function traceparentOf(event) {
  const fromEnvelope = extractTrace(event);
  if (fromEnvelope) return fromEnvelope.traceparent;
  return parseTraceparent(event.traceparent) ? event.traceparent.toLowerCase() : null;
}

/** Shallow copy with raw identity keys removed (non-object payloads pass through). */
function withoutIdentity(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const copy = { ...payload };
  for (const key of IDENTITY_KEYS) delete copy[key];
  return copy;
}

export class InMemoryAuditSink {
  constructor({ maxEntries = 10_000 } = {}) {
    this.maxEntries = maxEntries;
    this.events = [];
    this.ids = new Set();
  }

  async append(event) {
    if (this.ids.has(event.id)) return false;
    this.ids.add(event.id);
    this.events.push(event);
    while (this.events.length > this.maxEntries) {
      const removed = this.events.shift();
      this.ids.delete(removed.id);
    }
    return true;
  }

  latest(limit = 100) {
    return this.events.slice(-limit).reverse();
  }
}

export class ContractEventStreamer {
  constructor({
    fetchEvents,
    sink = new InMemoryAuditSink(),
    cursor = null,
    intervalMs = 5_000,
    normalize = normalizeContractEvent,
    onError = () => {},
    attributionSecret = null,
  } = {}) {
    if (typeof fetchEvents !== "function") throw new Error("fetchEvents function is required");
    this.fetchEvents = fetchEvents;
    this.sink = sink;
    this.cursor = cursor;
    this.intervalMs = intervalMs;
    this.normalize = normalize;
    this.attributionSecret = attributionSecret;
    this.onError = onError;
    this.timer = null;
    this.running = false;
  }

  async poll() {
    if (this.running) return { appended: 0, cursor: this.cursor };
    this.running = true;
    let appended = 0;
    try {
      const batch = await this.fetchEvents({ cursor: this.cursor });
      const events = Array.isArray(batch) ? batch : batch.events || [];
      for (const raw of events) {
        const normalized = this.normalize(raw, { attributionSecret: this.attributionSecret });
        if (await this.sink.append(normalized)) appended++;
        this.cursor = raw.cursor || raw.pagingToken || normalized.id;
      }
      if (!Array.isArray(batch) && batch.cursor) this.cursor = batch.cursor;
      return { appended, cursor: this.cursor };
    } catch (err) {
      this.onError(err);
      throw err;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      this.poll().catch(() => {});
    }, this.intervalMs);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createAuditStreamer(options) {
  return new ContractEventStreamer(options);
}

// ── ADR-020 dispatch shedding audit ────────────────────────────────────────
//
// Every message shed by the dispatch queue (or by federation overload control)
// is written here with a timestamp, tier and reason. The record is built from
// an allow-list of non-identifying fields only: no wallet, request id, note or
// responder address is ever copied into the row.

const dispatchShedSink = new InMemoryAuditSink();

/** Fields copied to an audit row. Anything not listed here cannot be logged. */
const SHED_ALLOWED_FIELDS = ["tier", "reason", "messageType"];

export function getDispatchShedSink() {
  return dispatchShedSink;
}

export async function latestDispatchShed(limit = 100) {
  return dispatchShedSink.latest(limit);
}

export function clearDispatchShed() {
  dispatchShedSink.events.length = 0;
  dispatchShedSink.ids.clear();
}

/**
 * Record one shed event. `event` may contain extra caller fields (requestId,
 * wallet, ...) but they are discarded before the row is normalized/stored.
 */
export async function recordDispatchShed(event = {}, now = Date.now()) {
  const observedAt = new Date(now).toISOString();
  const payload = {};
  for (const field of SHED_ALLOWED_FIELDS) {
    const value = event[field];
    if (typeof value === "string" && value.length <= 64) payload[field] = value;
  }
  payload.at = now;

  const row = normalizeContractEvent(
    {
      id: `dispatch-shed:${now}:${payload.tier || "unknown"}:${payload.reason || "unknown"}:${dispatchShedSink.events.length}`,
      source: "dispatch",
      observedAt,
      type: "dispatch_shed",
      topic: "dispatch_shed",
      payload,
    },
    { source: "dispatch_shed", observedAt, attributionSecret: null },
  );
  await dispatchShedSink.append(row);
  return row;
}

// Join receipts live in src/lib so the client can emit them too (#932).
export { createJoinReceipt, verifyJoinCompleteness } from '../../src/lib/joinReceipt.js';
