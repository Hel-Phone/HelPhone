/**
 * apps/web/src/lib/stellar/payments.ts
 *
 * Paginated payment history reader for a Stellar account.
 *
 * Fetches from the Horizon REST API directly so the response shape is
 * predictable and fully interceptable by MSW in tests.  Cursor-based
 * pagination is supported via the `nextCursor` field returned on each page.
 */

const HORIZON_URL = import.meta.env.VITE_HORIZON_URL as string

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single payment record as returned by Horizon. */
export type PaymentRecord = {
  id: string
  type: string
  created_at: string
  transaction_hash: string
  from: string
  to: string
  asset_type: string
  asset_code?: string
  asset_issuer?: string
  amount: string
}

/** Result of a single paginated fetch. */
export type PaymentPage = {
  /** Payment records for this page. */
  records: PaymentRecord[]
  /**
   * Opaque cursor to pass on the next call to get the following page.
   * `null` when there are no more pages.
   */
  nextCursor: string | null
}

export type FetchPaymentHistoryOptions = {
  /** Records per page (default: 10). */
  limit?: number
  /** Cursor from a previous page's `nextCursor`. Omit to start from the most recent payment. */
  cursor?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the `cursor` query param from a Horizon `_links.next.href`. */
function cursorFromNextHref(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    return new URL(href).searchParams.get("cursor")
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch one page of payment history for `accountId` from Horizon.
 *
 * @example
 * const page1 = await fetchPaymentHistory("GAAA...", { limit: 20 })
 * if (page1.nextCursor) {
 *   const page2 = await fetchPaymentHistory("GAAA...", { limit: 20, cursor: page1.nextCursor })
 * }
 */
export async function fetchPaymentHistory(
  accountId: string,
  options: FetchPaymentHistoryOptions = {},
): Promise<PaymentPage> {
  const limit = options.limit ?? 10

  const url = new URL(`${HORIZON_URL}/accounts/${accountId}/payments`)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("order", "desc")
  if (options.cursor) {
    url.searchParams.set("cursor", options.cursor)
  }

  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`Horizon payments error: ${res.status} ${res.statusText}`)
  }

  const json = await res.json() as {
    _links?: { next?: { href?: string } | null }
    _embedded?: { records?: PaymentRecord[] }
  }

  const records: PaymentRecord[] = json._embedded?.records ?? []
  const nextHref = json._links?.next?.href ?? null
  // Only surface a cursor when the page is full — a partial page means we're done.
  const nextCursor = records.length < limit ? null : cursorFromNextHref(nextHref)

  return { records, nextCursor }
}

/**
 * Fetch all payment pages for `accountId` and return them merged into a
 * single flat array.
 *
 * ⚠️  For accounts with large history this issues many requests.
 * Prefer `fetchPaymentHistory` with cursor pagination for production UIs.
 */
export async function fetchAllPaymentHistory(
  accountId: string,
  options: Omit<FetchPaymentHistoryOptions, "cursor"> = {},
): Promise<PaymentRecord[]> {
  const all: PaymentRecord[] = []
  let cursor: string | undefined

  for (;;) {
    const page = await fetchPaymentHistory(accountId, { ...options, cursor })
    all.push(...page.records)
    if (!page.nextCursor) break
    cursor = page.nextCursor
  }

  return all
}
