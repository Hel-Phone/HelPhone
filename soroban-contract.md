// Implementation added

## M-of-N admin governance

`configure_multisig` stores the authorized signer set and threshold. An authorized
signer creates an admin-transfer proposal with `create_admin_proposal`; each signer
may call `approve_admin_proposal` once. `execute_admin_proposal` rejects execution
until approvals meet the threshold and permanently marks executed proposals to
prevent replay. The constructor defaults to a backwards-compatible 1-of-1 set.

## Multi-asset treasury — `aegis_vault` (#541)

`contracts/aegis_vault/src/treasury.rs` tracks a reserve per asset and enforces
per-asset daily disbursement caps. Reserves are credited by `fund_zone` and
`treasury_deposit`, and debited by `claim_aid` and `treasury_withdraw`.

| Function | Auth | Notes |
| --- | --- | --- |
| `treasury_assets()` / `treasury_reserve(asset)` | – | Registered assets and their reserves |
| `add_treasury_asset(admin, asset)` | admin | Registers an asset (idempotent) |
| `treasury_deposit(from, asset, amount)` | `from` | Asset must be registered |
| `treasury_withdraw(admin, asset, to, amount)` | admin | Counts against the daily cap |
| `set_daily_limit(admin, asset, limit)` / `daily_limit` / `spent_today` / `remaining_today` | admin (set) | Cap resets each UTC day (`timestamp / 86400`). Constructor sets the vault token to 10 default payouts (500 tokens) |
| `set_target_weights(admin, assets, weights_bps)` / `target_weight` | admin (set) | Sum ≤ 10 000 bps |
| `rebalance_plan(prices)` | – | Read-only: signed buy(+)/sell(−) per asset to reach the targets. `prices` are in `treasury_assets` order. The vault never swaps; execution is off-chain or via a DEX adapter |

A claim that would exceed the daily cap fails with `DailyLimitExceeded` (9)
before the nullifier is burned or any balance moves, so the claimant can retry
the next day. Other new errors: `UnknownAsset` (10), `InvalidWeights` (11),
`InvalidPrices` (12). `fund_zone` takes the 160-byte public-inputs prefix
(campaign id = bytes 128..160), as before.

Frontend: `getTreasurySnapshot`, `getTreasuryRebalancePlan`,
`setTreasuryDailyLimit` in `src/lib/contract.ts`; reserves render in
`VaultDashboard.jsx` via `TreasuryPanel` (refreshed every 15 s).

## Price oracle adapter — `helphone_dao` (#543)

`contracts/helphone_dao/src/oracle.rs` reads SEP-40 feeds (e.g. Reflector) via
`lastprice(asset)`. Prices are quoted against the feed's base asset, so
`convert(amount, from, to) = amount * price(from) / price(to)`, rounded down.

- **Stale guard:** a price older than `MAX_PRICE_AGE_SECS` (3600 s) aborts with
  `StalePrice` (14). One stale leg rejects the whole conversion. Prices dated
  more than 60 s in the future, or `<= 0`, abort with `InvalidPrice` (16); a
  missing price aborts with `PriceUnavailable` (15).
- **Entry points:** `set_oracle(admin, oracle)`, `get_oracle()`,
  `quote_conversion(from_token, to_token, amount)` and
  `disburse_aid(admin, recipient, source_token, payout_token, source_amount)`,
  which pays the converted amount from the DAO's balance.
- **Other errors:** `OracleNotSet` (13), `InvalidAmount` (17), `Overflow` (18).

Frontend: `getOracleQuote(from, to, amount)` (needs `VITE_HELPHONE_DAO_ID`)
maps these codes to user-facing messages (`src/lib/treasury.ts`); the dashboard
has a live quote form.

The DAO crate previously did not compile (syntax errors in `cast_vote` /
`execute_proposal`, missing `total_supply` client, non-`Copy` error enum);
those are fixed so the oracle work is testable, and governance now has tests.
