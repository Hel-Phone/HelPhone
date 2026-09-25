# Security Architecture: Supply Chain Monitoring

This document covers the supply chain security index served by the prover (#600). It builds on the build-pipeline gates from #624–#627 (`scripts/security/`).

## Components

```
package-lock.json            ┐
security-audit.json          ├─> computeSupplyChainReport() ─┬─> GET /api/supply-chain            (JSON)
node_modules/*/package.json  ┘   (cached 60s per worker)     ├─> GET /api/supply-chain/dashboard  (HTML)
                                                             └─> GET /metrics/security           (Prometheus)

scripts/security/license_policy.js  is shared with  scripts/security/license_compliance.js (CI gate)
```

| File                                   | Role                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `server/routes/supplyChainSecurity.ts` | Report computation, dashboard rendering, routers                                               |
| `server/middleware/metrics.ts`         | Prometheus text-format renderer, `helphone_http_requests_total` counter                        |
| `scripts/security/license_policy.js`   | Approved/denied license matrix and exceptions (single source of truth)                         |
| `security-audit.json`                  | `npm audit --json --omit=dev` snapshot written at build time (`npm run security:audit-report`) |

## Design decisions

**No shelling out on the request path.** `npm audit` makes network calls and takes seconds. If an endpoint could trigger it, anyone could use that endpoint to exhaust the prover. CVE data is therefore a build-time snapshot, and the report exposes `reportAgeSeconds` so a stale snapshot is visible. Prometheus exports it as `helphone_audit_report_age_seconds`.

**Missing data is never scored as good.** If the audit snapshot is missing or malformed, `vulnerabilities.source` is `unavailable` and `index.partial` is `true`. The composite index is then computed from the other components only. Alert on `helphone_supply_chain_index_partial == 1` in production.

**No new dependencies.** The metrics exporter is about 80 lines of built-in-only code, not `prom-client`. A supply chain endpoint should not widen the supply chain it reports on.

**Low label cardinality.** Request counters use the matched Express route template (`/api/responder-status/:address`), never the raw URL. Unmatched requests are bucketed as `unmatched`. That keeps addresses and nullifiers out of metric labels.

**Dashboard hardening.** The dashboard is static server-rendered HTML with every value HTML-escaped. It is served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`, so it runs no scripts and makes no outbound fetches.

## Scoring

The composite index is a weighted mean of four 0–100 components. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60, F below that.

| Component          | Weight | Formula                                                                                                   |
| ------------------ | ------ | --------------------------------------------------------------------------------------------------------- |
| Vulnerabilities    | 0.4    | `100 − (40·critical + 15·high + 4·moderate + 1·low)`, floored at 0                                        |
| Lockfile integrity | 0.3    | `% packages with integrity hash − 5 per non-registry source − 1 per sha1-only hash`; 0 without a lockfile |
| License compliance | 0.2    | `% packages on the approved matrix`; 0 if any non-excepted GPL/AGPL dependency exists                     |
| Sustainability     | 0.1    | `100 − 1000 × (deprecated / total)`                                                                       |

If a component is `null` (currently only vulnerabilities, when no snapshot exists), its weight is redistributed across the remaining components.

Non-registry sources are listed explicitly (e.g. the JSR-hosted `@creit-tech/stellar-wallets-kit`). They are not necessarily bad, but they skip npm's registry signing, so each one should be a deliberate choice.

## Suggested alerts

```yaml
- alert: SupplyChainCriticalCVE
  expr: helphone_dependency_vulnerabilities{severity="critical"} > 0
- alert: SupplyChainIndexPartial
  expr: helphone_supply_chain_index_partial == 1
  for: 1h
- alert: SupplyChainAuditStale
  expr: helphone_audit_report_age_seconds > 7 * 24 * 3600
- alert: DeniedLicenseIntroduced
  expr: helphone_dependency_licenses{status="denied"} > 0
```

# Content Security Policy: Dynamic Nonce Injector (#530)

`server/middleware/csp.ts` gives every HTTP response its own cryptographic nonce and a strict policy that only trusts scripts and styles carrying it.

## Flow

```
vite build ──> dist/index.html   <script nonce="__CSP_NONCE__" ...>   (html.cspNonce in vite.config.ts)
                     │
request ──> createCspMiddleware ──> res.locals.cspNonce = random 128-bit value
                     │              Content-Security-Policy: ... 'nonce-<value>' ...
                     └──> createHtmlHandler ──> injectNonce(html, <value>) ──> Cache-Control: no-store
```

The header and the markup use the same value because both come from `res.locals.cspNonce`. The handler refuses to render if the middleware did not run first, instead of serving scripts a strict policy would block.

## The policy

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'none'` | Everything not listed is denied |
| `script-src` | `'self'` `'nonce-…'` `'wasm-unsafe-eval'` | No `'unsafe-inline'`. `wasm-unsafe-eval` only lets the Noir/Barretenberg WASM compile; it does not allow `eval()` |
| `style-src` | `'self'` `'nonce-…'` `fonts.googleapis.com` | Inline `<style>` needs the nonce |
| `style-src-attr` | `'unsafe-inline'` | Nonces cannot mark `style=""` attributes, which React and Mapbox set at runtime. Scoped to attributes only |
| `connect-src` | `'self'` + allowlist | Soroban RPC, Horizon, Mapbox and the API. Extend with `CSP_CONNECT_SRC` |
| `object-src` / `frame-ancestors` | `'none'` | No plugins, no framing |
| `base-uri` / `form-action` | `'self'` | Blocks base-tag and form-hijack injection |

## Configuration

| Variable | Effect |
| --- | --- |
| `CSP_CONNECT_SRC` | Comma-separated extra `connect-src` origins. Each must be `scheme://host[:port]` with an optional leading `*.`; anything else (`*`, `https:`, entries containing `;` or `,`) is dropped with a warning, never added to the header |
| `CSP_REPORT_ONLY` | `true` sends `Content-Security-Policy-Report-Only` so a change can be observed before it is enforced |
| `CSP_REPORT_URI` | Path or URL browsers POST violation reports to |

`upgrade-insecure-requests` is added when `NODE_ENV=production`.

## Design decisions

**HTML with a nonce is never cacheable.** A cached page would replay an old nonce against a new header (or the reverse) and break the app, or worse, make a reused nonce guessable. The HTML route sends `Cache-Control: no-store`. Hashed static assets under `dist/` are unaffected.

**Invalid configuration fails closed.** A bad `CSP_CONNECT_SRC` entry is discarded rather than interpolated, so an environment typo cannot widen the policy or inject a header.

**The service worker precaches `index.html`.** A precached shell would serve a stale nonce. Keep the navigation route network-first for HTML when this ships; until then a service-worker-served page will be blocked by the policy rather than run unnonced scripts.

**Unchanged for API-only deploys.** The HTML route falls through when `dist/index.html` does not exist.
