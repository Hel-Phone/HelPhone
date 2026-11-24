/**
 * Priority-aware dispatch queue preventing urgent requests from starvation.
 * Addresses ISP-062: Vector-clock causal fence vs wall-clock dispatch priority inversion.
 *
 * Implements:
 *  - Four ADR-020 tiers (P0..P3) bounded by message type only — never by
 *    wallet identity, responder role, or reputation score.
 *  - P0 (life-critical) is unbounded and is never shed. P1/P2/P3 drop the
 *    oldest entry when their configured bound is reached.
 *  - LocUpd (P3) coalescing: a newer update for the same coalesceKey replaces
 *    the older queued update instead of growing the queue.
 *  - A total memory budget. When it is reached, lower tiers are shed first and
 *    an overload signal is emitted so the HTTP surface can return 503 Overloaded.
 *  - Aging mechanism preventing stale updates from starving new urgent requests.
 *  - Round-robin fairness with configurable weight ratios.
 */

export type DispatchPriority = 'critical' | 'high' | 'normal' | 'low'
export type Adr020Tier = 'P0' | 'P1' | 'P2' | 'P3'
export type ShedReason = 'queue_bound' | 'coalesced' | 'memory_budget' | 'overloaded'

export interface DispatchItem {
  id: string
  priority: DispatchPriority
  payload: unknown
  timestamp: number
  attempts: number
  maxRetries: number
  isUpdate?: boolean
  /** Opaque key used to coalesce repeated LocUpd (P3) messages. Never a tier input. */
  coalesceKey?: string
  /** Protocol message type, copied to shed audit rows. Never affects tiering here. */
  messageType?: string
}

export interface QueueMetrics {
  queued: number
  critical: number
  high: number
  normal: number
  low: number
  avgWaitTime: number
  maxWaitTime: number
  stalePrevented: number
  /** Total messages shed since construction/last clear, per tier-reason pair. */
  shed: number
  coalesced: number
  overloadEvents: number
  overloaded: boolean
  bounds: Record<DispatchPriority, number>
  memoryBudget: number
}

/** No identity fields are accepted here. Keys are the four message-type tiers. */
export type DispatchQueueBounds = Record<DispatchPriority, number>

export interface DispatchQueueOptions {
  bounds?: Partial<DispatchQueueBounds>
  /** Total queued-item budget. P0 is never dropped, so reaching it emits 503. */
  memoryBudgetItems?: number
  onShed?: (event: ShedEvent) => void
  onOverload?: (event: OverloadEvent) => void
  onOverloadResolved?: () => void
}

/**
 * Internal shed record. Deliberately carries no payload/id fields so neither
 * this event nor the audit row derived from it can leak wallet addresses.
 */
export interface ShedEvent {
  at: number
  tier: Adr020Tier
  reason: ShedReason
  messageType?: string
}

export interface OverloadEvent {
  at: number
  tier: Adr020Tier
  queued: number
  memoryBudget: number
}

export interface EnqueueResult {
  accepted: boolean
  priority: DispatchPriority
  tier: Adr020Tier
  overloaded: boolean
  reason?: ShedReason
}

const PRIORITY_WEIGHTS: Record<DispatchPriority, number> = { critical: 100, high: 10, normal: 5, low: 1 }
const AGING_FACTOR = 0.95
const MAX_WAIT_TIME = 30_000
const STALE_UPDATE_THRESHOLD = 5_000
const TIERS: DispatchPriority[] = ['critical', 'high', 'normal', 'low']

/** ADR-020 §Option B. P0 is unbounded; the other bounds are configurable. */
export const DEFAULT_DISPATCH_BOUNDS: DispatchQueueBounds = {
  critical: Number.POSITIVE_INFINITY,
  high: 10_000,
  normal: 5_000,
  low: 1_000,
}

/** 10k + 5k + 1k bounded entries plus headroom for the unbounded P0 tier. */
export const DEFAULT_MEMORY_BUDGET_ITEMS = 17_000

export function toQueuePriority(input?: string | null): DispatchPriority {
  const normalized = input?.toString().trim().toLowerCase()
  if (normalized === 'critical' || normalized === 'p0') return 'critical'
  if (normalized === 'high' || normalized === 'p1') return 'high'
  if (normalized === 'low' || normalized === 'p3') return 'low'
  return 'normal'
}

export function toAdr020Tier(priority: DispatchPriority): Adr020Tier {
  if (priority === 'critical') return 'P0'
  if (priority === 'high') return 'P1'
  if (priority === 'low') return 'P3'
  return 'P2'
}

export class DispatchQueue {
  private queues = {
    critical: new Array<DispatchItem>(),
    high: new Array<DispatchItem>(),
    normal: new Array<DispatchItem>(),
    low: new Array<DispatchItem>(),
  }
  private processing = false
  private handlers: ((item: DispatchItem) => Promise<void>)[] = []
  private processedIds = new Set<string>()
  private metrics = { totalWaitTime: 0, processedCount: 0, stalePrevented: 0, shed: 0, coalesced: 0, overloadEvents: 0 }
  private roundRobinCredits: Record<DispatchPriority, number> = { critical: 0, high: 0, normal: 0, low: 0 }
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private readonly bounds: DispatchQueueBounds
  private readonly memoryBudgetItems: number
  private readonly onShed?: (event: ShedEvent) => void
  private readonly onOverload?: (event: OverloadEvent) => void
  private readonly onOverloadResolved?: () => void
  private overloaded = false

  constructor(options: DispatchQueueOptions = {}) {
    this.bounds = {
      critical: options.bounds?.critical ?? DEFAULT_DISPATCH_BOUNDS.critical,
      high: options.bounds?.high ?? DEFAULT_DISPATCH_BOUNDS.high,
      normal: options.bounds?.normal ?? DEFAULT_DISPATCH_BOUNDS.normal,
      low: options.bounds?.low ?? DEFAULT_DISPATCH_BOUNDS.low,
    }
    this.memoryBudgetItems = Math.max(1, options.memoryBudgetItems ?? DEFAULT_MEMORY_BUDGET_ITEMS)
    this.onShed = options.onShed
    this.onOverload = options.onOverload
    this.onOverloadResolved = options.onOverloadResolved
  }

  /**
   * Enqueue one message. Returns the tier it was assigned and whether it was
   * accepted. Tier selection depends only on the priority/message type supplied
   * by the caller; no wallet, responder or reputation field is ever read here.
   */
  enqueue(
    item: Omit<DispatchItem, 'attempts' | 'priority'> & { priority: DispatchPriority | Adr020Tier },
  ): EnqueueResult {
    const priority = toQueuePriority(item.priority)
    const tier = toAdr020Tier(priority)
    const fullItem: DispatchItem = { ...item, priority, attempts: 0 }
    const queued = this.size()

    if (queued >= this.memoryBudgetItems) {
      this.markOverloaded(tier)
      if (priority !== 'critical') {
        // P0 is never shed; every other tier is shed before the memory budget breaks.
        this.shed(tier, 'memory_budget', fullItem.messageType)
        return { accepted: false, priority, tier, overloaded: true, reason: 'memory_budget' }
      }
    }

    // ADR-003 §5 / ADR-020: coalesce LocUpd, keeping only the newest update.
    if (priority === 'low' && item.coalesceKey) {
      const existing = this.queues.low.findIndex((queued) => queued.coalesceKey === item.coalesceKey)
      if (existing >= 0) {
        this.queues.low.splice(existing, 1)
        this.shed(tier, 'coalesced', fullItem.messageType)
        this.metrics.coalesced++
      }
    }

    const bound = this.bounds[priority]
    if (Number.isFinite(bound) && this.queues[priority].length >= bound) {
      // Bounded tiers drop the oldest entry, never the incoming life-critical one.
      const dropped = this.queues[priority].shift()
      this.shed(tier, 'queue_bound', dropped?.messageType)
    }

    this.queues[priority].push(fullItem)
    const nowOverloaded = this.size() >= this.memoryBudgetItems
    if (nowOverloaded) this.markOverloaded(tier)
    return { accepted: true, priority, tier, overloaded: nowOverloaded }
  }

  private size(): number {
    return this.queues.critical.length + this.queues.high.length + this.queues.normal.length + this.queues.low.length
  }

  private shed(tier: Adr020Tier, reason: ShedReason, messageType?: string): void {
    this.metrics.shed++
    this.onShed?.({ at: Date.now(), tier, reason, messageType })
  }

  private markOverloaded(tier: Adr020Tier): void {
    if (!this.overloaded) {
      this.overloaded = true
      this.metrics.overloadEvents++
      this.onOverload?.({
        at: Date.now(),
        tier,
        queued: this.size(),
        memoryBudget: this.memoryBudgetItems,
      })
    }
  }

  isOverloaded(): boolean {
    return this.overloaded
  }

  getBounds(): DispatchQueueBounds {
    return { ...this.bounds }
  }

  onProcess(handler: (item: DispatchItem) => Promise<void>): void {
    this.handlers.push(handler)
  }

  startTick(intervalMs: number = 100): void {
    this.stopTick()
    this.tickTimer = setInterval(() => {
      void this.process()
    }, intervalMs)
    ;(this.tickTimer as { unref?: () => void }).unref?.()
  }

  stopTick(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  async process(): Promise<void> {
    if (this.processing) return
    this.processing = true

    try {
      while (this.hasItems()) {
        const item = this.selectNext()
        if (!item) break

        if (item.priority !== 'critical' && item.priority !== 'high') {
          const age = Date.now() - item.timestamp
          if (age > STALE_UPDATE_THRESHOLD) {
            const critical = this.peekCritical()
            if (critical && Date.now() - critical.timestamp < MAX_WAIT_TIME) {
              this.metrics.stalePrevented++
              continue
            }
          }
        }

        try {
          const startTime = Date.now()
          for (const handler of this.handlers) {
            await handler(item)
          }
          item.attempts++
          const duration = Date.now() - startTime
          this.metrics.totalWaitTime += duration
          this.metrics.processedCount++
          this.processedIds.add(item.id)
        } catch (err) {
          item.attempts++
          if (item.attempts < item.maxRetries) {
            this.enqueue(item)
          } else {
            console.error(`[DispatchQueue] Failed after ${item.attempts} attempts:`, item.id, err)
          }
        }
      }
    } finally {
      this.processing = false
      if (this.overloaded && this.size() < this.memoryBudgetItems) {
        this.overloaded = false
        this.onOverloadResolved?.()
      }
    }
  }

  private selectNext(): DispatchItem | undefined {
    const now = Date.now()
    // P0 (critical) always runs first when available.
    if (this.queues.critical.length > 0) {
      while (this.queues.critical.length > 0) {
        const item = this.queues.critical.shift()
        if (item && !this.processedIds.has(item.id)) {
          return item
        }
      }
    }

    // Weighted round-robin with aging for high/normal/low tiers.
    let bestTier: DispatchPriority | null = null
    let bestScore = -1

    for (const tier of TIERS) {
      const queue = this.queues[tier]
      if (queue.length === 0) continue

      const head = queue[0]
      const age = Math.max(0, now - head.timestamp)
      // Aging accelerates wait weight over time so non-stale items never exceed MAX_WAIT_TIME.
      const agingBoost = head.isUpdate && age > STALE_UPDATE_THRESHOLD ? 0 : age / (AGING_FACTOR * 1000)
      this.roundRobinCredits[tier] += PRIORITY_WEIGHTS[tier] + agingBoost

      if (this.roundRobinCredits[tier] > bestScore) {
        bestScore = this.roundRobinCredits[tier]
        bestTier = tier
      }
    }

    if (bestTier) {
      this.roundRobinCredits[bestTier] = Math.max(0, this.roundRobinCredits[bestTier] - bestScore)
      while (this.queues[bestTier].length > 0) {
        const item = this.queues[bestTier].shift()
        if (item && !this.processedIds.has(item.id)) {
          return item
        }
      }
    }

    for (const tier of TIERS) {
      while (this.queues[tier].length > 0) {
        const item = this.queues[tier].shift()
        if (item && !this.processedIds.has(item.id)) {
          return item
        }
      }
    }
    return undefined
  }

  private peekCritical(): DispatchItem | undefined {
    return this.queues.critical[0]
  }

  private hasItems(): boolean {
    return Object.values(this.queues).some((q) => q.length > 0)
  }

  getMetrics(): QueueMetrics {
    const now = Date.now()
    const allItems = Object.values(this.queues).flat()
    const avgWait = this.metrics.processedCount > 0 ? this.metrics.totalWaitTime / this.metrics.processedCount : 0
    const maxWaitTime =
      allItems.length === 0 ? 0 : Math.max(0, ...allItems.map((item) => Math.max(0, now - item.timestamp)))
    return {
      queued: allItems.length,
      critical: this.queues.critical.length,
      high: this.queues.high.length,
      normal: this.queues.normal.length,
      low: this.queues.low.length,
      avgWaitTime: avgWait,
      maxWaitTime,
      stalePrevented: this.metrics.stalePrevented,
      shed: this.metrics.shed,
      coalesced: this.metrics.coalesced,
      overloadEvents: this.metrics.overloadEvents,
      overloaded: this.overloaded,
      bounds: this.getBounds(),
      memoryBudget: this.memoryBudgetItems,
    }
  }

  clear(): void {
    this.stopTick()
    this.queues.critical = []
    this.queues.high = []
    this.queues.normal = []
    this.queues.low = []
    this.roundRobinCredits = { critical: 0, high: 0, normal: 0, low: 0 }
    this.processedIds.clear()
    this.metrics = { totalWaitTime: 0, processedCount: 0, stalePrevented: 0, shed: 0, coalesced: 0, overloadEvents: 0 }
    this.overloaded = false
  }
}
