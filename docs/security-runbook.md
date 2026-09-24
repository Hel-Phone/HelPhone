# Security Runbook — Supply Chain

Covers the typosquatting gate (#588) and the transitive vulnerability scanner (#589).

## Typosquatting gate (#588)

- Script: `scripts/detect-typosquatting.js` — Levenshtein distance over every
  name in `package.json` + `server/package.json` vs. a curated popular-package
  list. Distance 1 flags (distance 2 only for names ≥ 8 chars; bases < 5 chars
  skipped to avoid generic-base noise like `@playwright/test` vs `jest`).
- Maintainer check: `node scripts/detect-typosquatting.js --check-maintainers`
  queries npm metadata with a 5 s timeout. Offline/network failures warn only.
- Gate: `npm run security:typosquat` (also in CI `supply-chain` job). Exit 1 =
  PR blocked. Triage: verify the flagged name on npmjs.com, check publish age
  and maintainers, then rename or exception-document.

## Transitive vulnerability scan (#589)

- Script: `scripts/transitive-vulnerability-scanner.js` — builds the DAG from
  `package-lock.json` (`node_modules` nesting = depth), maps advisories in
  OSV shape onto exact versions, isolates hits at depth ≥ 5, and suggests
  `package.json` `overrides`.
- Offline default: `npm run security:transitive-vuln` reports graph stats
  (currently 1271 packages, max depth 4) and exits 0 with no advisories.
- Live OSV: append `--audit` (best-effort, warns offline). Pinned advisories:
  `--advisories <file>`. CRITICAL/HIGH hits exit 1.
- Cargo side: `contracts/**/Cargo.lock` are resolved with `stellar contract build`
  / `cargo test --locked`; suggested `[patch]` entries go through the same
  reviewer flow as npm `overrides` — never commit either without review.

## Rate-limit whitelist for emergency services (#536)

Verified emergency-service callers bypass the API rate limiter. Entries live in
Redis (`REDIS_URL`) so they change at runtime with no redeploy; without
`REDIS_URL` an in-process store is used (single instance, lost on restart —
dev/test only).

- Code: `server/middleware/whitelist.ts` (matching + admin API),
  `server/lib/redis.ts` (optional client), limiter hook in
  `server/middleware/rateLimiter.ts` and `createRateLimiter` in `server/index.js`.
- Match rules: request IP inside a whitelisted IPv4/IPv6 CIDR, **or** an
  `X-API-Key` header whose SHA-256 is registered. Match sets
  `req.bypassRateLimit`; nothing else is relaxed (CORS, auth and body limits
  still apply).
- **Set `TRUST_PROXY`** (`1` on Render) so `req.ip` is the real client. If it is
  wrong, either every caller looks like the proxy or `X-Forwarded-For` can be
  spoofed to fake a whitelisted IP.
- Fail closed: if Redis is unreachable the normal limit applies. Subnet lists
  are cached ~5 s per worker, so changes on other workers take up to that long.

### Admin API

Requires `Authorization: Bearer $WHITELIST_ADMIN_TOKEN`; returns 503 if the
token is unset and 401 on a bad token.

| Method & path | Body | Effect |
| --- | --- | --- |
| `GET /admin/whitelist` | – | List subnets and API-key metadata |
| `POST /admin/whitelist/subnets` | `{ "cidr": "203.0.113.0/24", "label": "County 911" }` | Add a subnet |
| `DELETE /admin/whitelist/subnets` | `{ "cidr": "203.0.113.0/24" }` | Remove a subnet |
| `POST /admin/whitelist/api-keys` | `{ "label": "Dispatch CAD" }` | Create a key; **the plaintext is returned once** and only its hash is stored |
| `DELETE /admin/whitelist/api-keys/:id` | – | Revoke a key by id |

Rotate `WHITELIST_ADMIN_TOKEN` like any other secret; treat a leaked API key as
revoked immediately.

## Dependency & license auditor (#540)

- Script: `scripts/audit-deps.js` — reads `package-lock.json` and
  `server/package-lock.json`; shares its license matrix with
  `scripts/security/license_compliance.js` (`license_policy.js`). Writes a
  deterministic `licenses.json` (no timestamps).
- Gate: `npm run security:audit-deps:check` (CI `supply-chain` job). Exit 1 =
  PR blocked. Server-only run: `npm run audit:deps --workspace server`.
- **DENIED** — GPL/AGPL/SSPL/EUPL/OSL/CPAL/RPL. Replace the dependency; only
  add to `EXCEPTIONS` in `license_policy.js` after legal review. Weak copyleft
  (LGPL/MPL/...) is a REVIEW warning; `--strict` promotes it to a failure.
- **INSTALL-SCRIPT** — a package gained a lifecycle script. Read the script
  (`npm view <pkg>@<ver> scripts`); if legitimate, add it to
  `INSTALL_SCRIPT_ALLOWLIST` with a reason. `suspicious-install-script` means
  the installed body matched curl|sh, eval, base64, remote URL or env-exfil
  patterns — treat as a possible compromise: do not install, pin the previous
  version and report upstream.
- **SOURCE** — resolved tarball is off the trusted registries (or http/git),
  or integrity is missing/weak. Usually a tampered lockfile: regenerate it
  from a clean checkout and diff.
- **STALE** — `licenses.json` no longer matches the lockfiles; run
  `npm run security:audit-deps` and commit.
