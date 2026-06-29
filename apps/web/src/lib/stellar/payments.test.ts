/**
 * apps/web/src/lib/stellar/payments.test.ts
 *
 * Unit tests for the Horizon payment history paginator.
 *
 * All HTTP is intercepted by MSW — no real Horizon calls are made.
 * The MSW server lifecycle is managed by setup-tests.ts (preloaded via
 * `bun test --preload ./setup-tests.ts`).
 *
 * Scenarios covered
 * ──────────────────
 * 1. Single page  – records returned, nextCursor is null.
 * 2. Multi-page   – cursor advancement; merged results span both pages.
 * 3. Empty history – zero records, nextCursor is null.
 * 4. fetchAllPaymentHistory – auto-follows cursors, returns flat merged array.
 */

import { describe, expect, it } from "vitest"
import { http, HttpResponse } from "msw"
import { server } from "../../../test/msw/server"
import {
  fetchPaymentHistory,
  fetchAllPaymentHistory,
  type PaymentRecord,
} from "./payments"

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
const PAYMENTS_URL = `https://horizon-testnet.stellar.org/accounts/${ACCOUNT}/payments`

function makeRecord(id: string, overrides: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id,
    type: "payment",
    created_at: "2024-01-01T00:00:00Z",
    transaction_hash: `txhash_${id}`,
    from: "GBBD47UZQ2YNRGESRV37TJZWQ6HC76ZK34CSXVGBTCVRXGT7GBNXVQ34",
    to: ACCOUNT,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GBBD47UZQ2YNRGESRV37TJZWQ6HC76ZK34CSXVGBTCVRXGT7GBNXVQ34",
    amount: "100.0000000",
    ...overrides,
  }
}

/**
 * Build a Horizon HAL collection page.
 * Pass `nextCursor` to populate `_links.next.href`; omit / null for last page.
 */
function horizonPage(records: PaymentRecord[], nextCursor: string | null = null) {
  return {
    _links: {
      self: { href: PAYMENTS_URL },
      next: nextCursor
        ? { href: `${PAYMENTS_URL}?cursor=${nextCursor}&limit=10&order=desc` }
        : null,
      prev: null,
    },
    _embedded: { records },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MSW handler helper – matches any request to the payments endpoint and
// dispatches based on the `cursor` query param.
// ─────────────────────────────────────────────────────────────────────────────

type CursorMap = Record<
  string, // cursor value ("" = no cursor)
  { records: PaymentRecord[]; nextCursor: string | null }
>

function paymentsHandler(pages: CursorMap) {
  return http.get(PAYMENTS_URL, ({ request }) => {
    const cursor = new URL(request.url).searchParams.get("cursor") ?? ""
    const page = pages[cursor] ?? { records: [], nextCursor: null }
    return HttpResponse.json(horizonPage(page.records, page.nextCursor))
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// fetchPaymentHistory – single page
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPaymentHistory – single page", () => {
  it("returns records and null nextCursor when page is not full", async () => {
    const records = [makeRecord("1"), makeRecord("2")]

    server.use(
      http.get(PAYMENTS_URL, () => HttpResponse.json(horizonPage(records, null))),
    )

    const page = await fetchPaymentHistory(ACCOUNT, { limit: 10 })

    expect(page.records).toHaveLength(2)
    expect(page.records[0]?.id).toBe("1")
    expect(page.records[1]?.id).toBe("2")
    expect(page.nextCursor).toBeNull()
  })

  it("surfaces all expected fields on each record", async () => {
    server.use(
      http.get(PAYMENTS_URL, () =>
        HttpResponse.json(horizonPage([makeRecord("42")])),
      ),
    )

    const page = await fetchPaymentHistory(ACCOUNT, { limit: 10 })

    expect(page.records[0]).toMatchObject({
      id: "42",
      type: "payment",
      asset_code: "USDC",
      amount: "100.0000000",
      transaction_hash: "txhash_42",
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchPaymentHistory – multi-page / cursor advancement
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPaymentHistory – multi-page pagination", () => {
  it("returns nextCursor when page is exactly full (records.length === limit)", async () => {
    const records = [makeRecord("a"), makeRecord("b"), makeRecord("c")]

    server.use(
      http.get(PAYMENTS_URL, () =>
        HttpResponse.json(horizonPage(records, "cursor_page2")),
      ),
    )

    const page = await fetchPaymentHistory(ACCOUNT, { limit: 3 })

    expect(page.records).toHaveLength(3)
    expect(page.nextCursor).toBe("cursor_page2")
  })

  it("passes cursor on second request and advances correctly", async () => {
    const page1Records = [makeRecord("10"), makeRecord("9"), makeRecord("8")]
    const page2Records = [makeRecord("7"), makeRecord("6")]

    server.use(
      paymentsHandler({
        "": { records: page1Records, nextCursor: "cursor_xyz" },
        cursor_xyz: { records: page2Records, nextCursor: null },
      }),
    )

    const first = await fetchPaymentHistory(ACCOUNT, { limit: 3 })
    expect(first.records.map((r) => r.id)).toEqual(["10", "9", "8"])
    expect(first.nextCursor).toBe("cursor_xyz")

    const second = await fetchPaymentHistory(ACCOUNT, { limit: 3, cursor: "cursor_xyz" })
    expect(second.records.map((r) => r.id)).toEqual(["7", "6"])
    expect(second.nextCursor).toBeNull()

    // Caller merges the two pages
    const merged = [...first.records, ...second.records]
    expect(merged.map((r) => r.id)).toEqual(["10", "9", "8", "7", "6"])
  })

  it("returns null nextCursor when _links.next is absent on a full page", async () => {
    // Edge case: full page but Horizon omits next link → treat as last page
    const records = [makeRecord("1"), makeRecord("2")]
    server.use(
      http.get(PAYMENTS_URL, () =>
        HttpResponse.json({
          _links: { self: { href: PAYMENTS_URL }, next: null },
          _embedded: { records },
        }),
      ),
    )

    const page = await fetchPaymentHistory(ACCOUNT, { limit: 2 })
    // records.length === limit but no next href → nextCursor still null
    // (cursor from null href returns null)
    expect(page.nextCursor).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchPaymentHistory – empty history fallback
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchPaymentHistory – empty history", () => {
  it("returns empty records and null nextCursor with explicit options", async () => {
    server.use(
      http.get(PAYMENTS_URL, () => HttpResponse.json(horizonPage([], null))),
    )

    const page = await fetchPaymentHistory(ACCOUNT, { limit: 10 })

    expect(page.records).toHaveLength(0)
    expect(page.nextCursor).toBeNull()
  })

  it("returns empty records and null nextCursor with default options", async () => {
    server.use(
      http.get(PAYMENTS_URL, () => HttpResponse.json(horizonPage([], null))),
    )

    const page = await fetchPaymentHistory(ACCOUNT)

    expect(Array.isArray(page.records)).toBe(true)
    expect(page.records).toHaveLength(0)
    expect(page.nextCursor).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fetchAllPaymentHistory – auto-follow cursors
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchAllPaymentHistory", () => {
  it("follows cursors across pages and returns merged flat array", async () => {
    server.use(
      paymentsHandler({
        "": { records: [makeRecord("a"), makeRecord("b")], nextCursor: "cur_1" },
        cur_1: { records: [makeRecord("c"), makeRecord("d")], nextCursor: "cur_2" },
        cur_2: { records: [makeRecord("e")], nextCursor: null },
      }),
    )

    const all = await fetchAllPaymentHistory(ACCOUNT, { limit: 2 })

    expect(all.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"])
  })

  it("returns empty array for an account with no payment history", async () => {
    server.use(
      http.get(PAYMENTS_URL, () => HttpResponse.json(horizonPage([], null))),
    )

    const all = await fetchAllPaymentHistory(ACCOUNT)

    expect(all).toEqual([])
  })
})
