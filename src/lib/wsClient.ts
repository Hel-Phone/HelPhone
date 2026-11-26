import { classifyProbeFailure, type ProbeFailureClass } from './networkEstimator';
import { isOverloadSignal, OverloadFallback } from './overloadFallback';
import {
  createRaceTracker,
  decideRace,
  isRaceFlagOn,
  readMeteredSignal,
  readSyncBatteryLevel,
  type NavigatorWithSignals,
  type PayloadClass,
  type RaceDecision,
  type RaceHourTracker,
} from './raceGate';

export type ConnectionState = 'CONNECTING' | 'OPEN' | 'RECONNECTING' | 'FAILED' | 'DEGRADED';

/** Origin tag injected into kiosk-sourced intent messages. */
export const KIOSK_ORIGIN_TAG = 'KIOSK-UNVERIFIED' as const;

export interface WsClientOptions {
  url: string;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onStateChange?: (state: ConnectionState) => void;
  onMessage?: (data: unknown) => void;
  onResync?: () => void;
  /** Bounded polling fallback used when dispatch reports 503 Overloaded. */
  overloadFallback?: OverloadFallback;
  pollUrl?: string;
  pollIntervalMs?: number;
  onDegradedChange?: (degraded: boolean) => void;
  raceFlagOn?: boolean;
  operatorOverride?: boolean;
  secondarySend?: (payload: string) => void;
  navigator?: NavigatorWithSignals | null;
  now?: () => number;
}

export interface WsDispatchOptions {
  payload?: PayloadClass;
  stalled?: boolean;
  rttMs?: number;
  metered?: boolean;
  batteryLevel?: number | null;
  operatorOverride?: boolean;
  raceFlagOn?: boolean;
  secondarySend?: (payload: string) => void;
}

/**
 * WebSocket client with exponential backoff + jitter reconnection.
 * Delay sequence: base * 2^attempt, capped at maxDelayMs, with up to
 * 50% random jitter added to avoid thundering-herd reconnects.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'CONNECTING';
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyClosed = false;

  private readonly url: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly raceTracker: RaceHourTracker;
  private readonly inboundDedupe = new ReplayCache();
  private cachedBatteryLevel: number | null = null;
  private duplicatesDropped = 0;
  private racesFired = 0;
  private lastFailureClass: ProbeFailureClass | null = null;
  private degraded = false;
  private readonly overloadFallback: OverloadFallback;
  /** Writes attempted while degraded, de-duplicated and flushed exactly once on recovery. */
  private deferredSends: Array<{ key: string; data: string }> = [];

  constructor(private options: WsClientOptions) {
    this.url = options.url;
    this.maxRetries = options.maxRetries ?? Infinity;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.now = options.now ?? (() => Date.now());
    this.raceTracker = createRaceTracker(this.now);
    this.overloadFallback =
      options.overloadFallback ??
      new OverloadFallback({
        pollUrl: options.pollUrl,
        pollIntervalMs: options.pollIntervalMs,
        onDegradedChange: (degraded) => {
          this.degraded = degraded;
          this.options.onDegradedChange?.(degraded);
        },
        onMessages: (messages) => this.options.onMessage?.(messages),
      });
    this.watchBattery();
  }

  private getNavigator(): NavigatorWithSignals | null {
    if (this.options.navigator !== undefined) return this.options.navigator;
    return typeof navigator !== 'undefined' ? (navigator as unknown as NavigatorWithSignals) : null;
  }

  private watchBattery(): void {
    const nav = this.getNavigator();
    if (!nav || typeof nav.getBattery !== 'function') return;
    nav
      .getBattery()
      .then((battery) => {
        if (!battery) return;
        const update = () => {
          if (typeof battery.level === 'number' && Number.isFinite(battery.level)) {
            this.cachedBatteryLevel = battery.level;
          }
        };
        update();
        battery.addEventListener?.('levelchange', update);
      })
      .catch(() => {});
  }

  connect(): void {
    this.manuallyClosed = false;
    this.setState(this.attempt === 0 ? 'CONNECTING' : 'RECONNECTING');
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      const wasReconnect = this.attempt > 0;
      const wasDegraded = this.degraded;
      this.attempt = 0;
      this.setState('OPEN');
      if (wasDegraded) this.recoverFromDegraded();
      if (wasReconnect || wasDegraded) {
        this.options.onResync?.();
      }
    };

    this.ws.onmessage = (event) => {
      this.handleInboundMessage(event.data);
    };

    this.ws.onclose = () => {
      if (this.manuallyClosed) return;
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // Browsers expose no error detail on WebSocket, so the bucket comes from the endpoint shape (#928).
      this.lastFailureClass = classifyProbeFailure(this.url, { error: 'websocket error' });
      this.ws?.close();
    };
  }

  handleInboundMessage(raw: unknown): boolean {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }
    if (parsed && typeof parsed === 'object') {
      const record = parsed as Record<string, unknown>;
      const key = record.idempotencyKey ?? record.id ?? record.nonce;
      if (typeof key === 'string' || typeof key === 'number') {
        if (!this.inboundDedupe.checkAndAdd(String(key), this.now())) {
          this.duplicatesDropped++;
          return false;
        }
      }
    }
    if (isOverloadSignal(parsed)) this.enterDegraded(parsed);
    this.options.onMessage?.(parsed);
    return true;
  }

  /** Switch to bounded polling on 503 Overloaded. Idempotent. */
  enterDegraded(signal?: unknown): void {
    if (!this.degraded) {
      this.degraded = true;
      this.options.onDegradedChange?.(true);
    }
    this.overloadFallback.enterOverload(signal);
    this.setState('DEGRADED');
  }

  /** Leave degraded mode and flush deferred writes exactly once. */
  private recoverFromDegraded(): void {
    this.degraded = false;
    this.overloadFallback.recover();
    this.options.onDegradedChange?.(false);
    const pending = this.deferredSends;
    this.deferredSends = [];
    if (this.ws && this.state === 'OPEN') {
      for (const entry of pending) this.ws.send(entry.data);
    }
  }

  getDegraded(): boolean {
    return this.degraded;
  }

  getOverloadFallback(): OverloadFallback {
    return this.overloadFallback;
  }

  /** Hold a write while degraded; dedupe by idempotency key so reconnect is safe. */
  private deferSend(data: unknown): string {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data);
    let key = serialized;
    try {
      const parsed = JSON.parse(serialized) as Record<string, unknown>;
      key = String(parsed.idempotencyKey ?? parsed.id ?? parsed.nonce ?? serialized);
    } catch {
      // Non-JSON payloads are keyed by their serialized bytes.
    }
    if (!this.deferredSends.some((entry) => entry.key === key)) {
      this.deferredSends.push({ key, data: serialized });
      if (this.deferredSends.length > 50) this.deferredSends.shift();
    }
    return key;
  }

  getDuplicatesDropped(): number {
    return this.duplicatesDropped;
  }

  /** Class of the most recent socket error, or null before any error (#928). */
  getLastFailureClass(): ProbeFailureClass | null {
    return this.lastFailureClass;
  }

  getRacesFired(): number {
    return this.racesFired;
  }

  private scheduleReconnect(): void {
    if (this.attempt >= this.maxRetries) {
      this.setState('FAILED');
      return;
    }

    const backoff = this.computeBackoffDelay(this.attempt);
    // While degraded, reconnect no faster than the bounded poll interval so a
    // 503 storm cannot turn into a reconnect storm.
    const delay = this.degraded
      ? Math.min(this.maxDelayMs, Math.max(backoff, this.overloadFallback.getState().pollIntervalMs))
      : backoff;
    this.attempt += 1;
    this.setState('RECONNECTING');

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  /** Exponential backoff (1s -> 2s -> 4s -> 8s...) with up to 50% jitter. */
  computeBackoffDelay(attempt: number): number {
    const exponential = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs);
    const jitter = exponential * 0.5 * Math.random();
    return Math.round(exponential + jitter);
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    this.options.onStateChange?.(state);
  }

  getState(): ConnectionState {
    return this.state;
  }

  send(data: unknown): void {
    if (this.degraded) {
      this.deferSend(data);
      return;
    }
    if (this.ws && this.state === 'OPEN') {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    }
  }

  /**
   * Send a dispatch payload gated by the pure P0 multipath race policy (#959).
   * P1 and bulk payloads never race; P0 races at most once on a stalled path
   * when not vetoed by metered bearer, low battery, or the rolling hourly cap.
   */
  sendDispatch(
    data: Record<string, unknown>,
    opts: WsDispatchOptions = {},
  ): { sent: boolean; raced: boolean; deferred: boolean; decision: RaceDecision } {
    const nav = this.getNavigator();
    const rawPayload = opts.payload ?? (data.payloadClass as PayloadClass) ?? (data.priority as PayloadClass) ?? 'P1';
    const payload: PayloadClass = rawPayload === 'P0' || rawPayload === 'P1' || rawPayload === 'bulk' ? rawPayload : 'P1';
    const flagOn =
      opts.raceFlagOn ??
      this.options.raceFlagOn ??
      isRaceFlagOn(
        (typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_MULTIPATH_RACE : undefined) ??
          (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.VITE_MULTIPATH_RACE,
      );
    const stalled = opts.stalled ?? this.state === 'RECONNECTING';
    const metered = opts.metered ?? readMeteredSignal(nav);
    const batteryLevel =
      opts.batteryLevel !== undefined
        ? opts.batteryLevel
        : readSyncBatteryLevel(nav, this.cachedBatteryLevel);
    const operatorOverride = Boolean(opts.operatorOverride ?? this.options.operatorOverride);
    const rttMs = opts.rttMs ?? 0;

    const decision = decideRace(flagOn, {
      payload,
      path: { rttMs, stalled, metered },
      batteryLevel,
      racesLastHour: this.raceTracker.count(this.now()),
      operatorOverride,
    });

    const serialized = JSON.stringify(data);
    let sent = false;
    if (this.degraded) {
      // No racing while degraded: one deferred write, flushed once on recovery.
      this.deferSend(data);
      return { sent: false, raced: false, deferred: true, decision: { ...decision, race: false } as RaceDecision };
    }
    if (this.ws && this.state === 'OPEN') {
      this.ws.send(serialized);
      sent = true;
    }

    let raced = false;
    if (decision.race) {
      this.raceTracker.record(this.now());
      this.racesFired++;
      const secondary = opts.secondarySend ?? this.options.secondarySend;
      if (secondary) {
        secondary(serialized);
        raced = true;
        sent = true;
      } else if (this.ws && this.state === 'OPEN') {
        this.ws.send(serialized);
        raced = true;
      }
    }

    return { sent, raced, deferred: false, decision };
  }

  /**
   * Send a message tagged as kiosk-origin. The server / ResponderTracker
   * must treat these as UNVERIFIED and route them to the triage queue rather
   * than auto-dispatching.
   */
  sendKiosk(data: Record<string, unknown>): void {
    this.send({ ...data, origin: KIOSK_ORIGIN_TAG });
  }

  close(): void {
    this.manuallyClosed = true;
    this.overloadFallback.dispose();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}

// ── Replay Cache & Peer Dialing (ISP-144) ──────────────────────────────────

export class ReplayCache {
  private cache = new Map<string, number>();
  private readonly windowMs: number;

  constructor(windowMs = 300_000) {
    this.windowMs = windowMs;
  }

  checkAndAdd(nonce: string, timestamp = Date.now()): boolean {
    this.cleanup(timestamp);
    if (this.cache.has(nonce)) return false;
    this.cache.set(nonce, timestamp);
    return true;
  }

  has(nonce: string): boolean {
    return this.cache.has(nonce);
  }

  size(): number {
    return this.cache.size;
  }

  private cleanup(now: number): void {
    for (const [nonce, ts] of this.cache) {
      if (now - ts > this.windowMs) {
        this.cache.delete(nonce);
      }
    }
  }
}

export interface PeerDialingOptions extends WsClientOptions {
  localInstanceId: string;
  peerInstanceId: string;
  signingKey?: string;
  onPeerHandshake?: (status: 'authenticating' | 'authenticated' | 'rejected') => void;
}

export class PeerDialingClient extends WsClient {
  readonly localInstanceId: string;
  readonly peerInstanceId: string;
  private readonly replayCache = new ReplayCache();
  private peerAuthenticated = false;

  constructor(private peerOptions: PeerDialingOptions) {
    super(peerOptions);
    this.localInstanceId = peerOptions.localInstanceId;
    this.peerInstanceId = peerOptions.peerInstanceId;
  }

  sendFederatedEnvelope(envelope: { nonce: string; senderInstance: string; recipientInstance: string; [key: string]: unknown }): boolean {
    if (envelope.recipientInstance !== this.peerInstanceId) {
      return false;
    }
    if (!this.replayCache.checkAndAdd(envelope.nonce)) {
      console.warn(`[PeerDialing] Dropping duplicate nonce: ${envelope.nonce}`);
      return false;
    }
    this.send({
      type: 'peer-relay',
      senderInstance: this.localInstanceId,
      peerInstance: this.peerInstanceId,
      envelope,
    });
    return true;
  }

  isPeerAuthenticated(): boolean {
    return this.peerAuthenticated;
  }

  markPeerAuthenticated(authenticated: boolean): void {
    this.peerAuthenticated = authenticated;
    this.peerOptions.onPeerHandshake?.(authenticated ? 'authenticated' : 'rejected');
  }
}

