import type {
  TreasuryAssetRow,
  DisbursementUsage,
  OracleErrorKind,
} from "../types/index";

/** Soroban token amounts use 7 decimals ("stroops"). */
export const STROOPS = 10_000_000;

/** Converts an on-chain i128 to a JS number; values beyond 2^53 (e.g. the
 *  i128::MAX "no cap" sentinel) become Infinity instead of losing precision. */
export function toAmount(val: unknown): number {
  if (typeof val === "bigint") {
    return val > BigInt(Number.MAX_SAFE_INTEGER) ? Infinity : Number(val);
  }
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

export function formatStroops(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "∞";
  return (value / STROOPS).toFixed(digits);
}

export function disbursementUsage(limit: number, spent: number): DisbursementUsage {
  if (!Number.isFinite(limit)) {
    return { unlimited: true, pct: 0, remaining: Infinity, exhausted: false };
  }
  const remaining = Math.max(0, limit - spent);
  const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 100;
  return { unlimited: false, pct, remaining, exhausted: remaining === 0 };
}

export function toAssetRow(
  asset: string,
  raw: {
    reserve: unknown;
    limit: unknown;
    spent: unknown;
    remaining: unknown;
    weight: unknown;
  },
): TreasuryAssetRow {
  return {
    asset,
    reserve: toAmount(raw.reserve),
    dailyLimit: toAmount(raw.limit),
    spentToday: toAmount(raw.spent),
    remainingToday: toAmount(raw.remaining),
    targetWeightBps: toAmount(raw.weight),
  };
}

/** Maps a DaoError contract code (see contracts/helphone_dao) to a UI category. */
export function classifyOracleError(err: unknown): OracleErrorKind {
  const msg = String((err as { message?: string })?.message ?? err ?? "");
  const code = /Error\(Contract, #(\d+)\)/.exec(msg)?.[1];
  switch (code) {
    case "13":
      return "not-configured";
    case "14":
      return "stale";
    case "15":
      return "unavailable";
    case "16":
    case "17":
    case "18":
      return "invalid";
    default:
      return "unknown";
  }
}

export const ORACLE_ERROR_MESSAGES: Record<OracleErrorKind, string> = {
  stale: "Price feed is more than 1 hour old. Try again once the oracle updates.",
  unavailable: "The oracle has no price for one of these assets.",
  invalid: "The oracle returned an invalid price, or the amount is invalid.",
  "not-configured": "No price oracle is configured for this DAO.",
  unknown: "Could not fetch a conversion quote.",
};
