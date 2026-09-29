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

# Browser Sandbox Isolation for Untrusted Web Workers

Worker code is not fully trusted: the ZK prover pulls in third-party WASM and JS runtimes, and the canvas/cluster workers run vendored algorithm modules. A worker normally shares the page's origin, so a bug or compromise there could read `localStorage` / `sessionStorage`, reach the app origin's IndexedDB and Cache storage, use DOM globals a library happened to leak, or smuggle prototype-polluting payloads across `postMessage`.

Three independent layers close that off (`src/lib/workerSandbox.ts`, wired in by `plugins/vite-plugin-worker-sandbox.js`, covered by `test/worker-sandbox.test.js`):

1. **Origin isolation.** The worker is launched from a `blob:` URL created *inside* an iframe marked `sandbox="allow-scripts"` (no `allow-same-origin`), so it inherits an opaque ("null") origin: no cookies, no app storage, no same-origin privileges. The iframe owns the `Worker` and relays both directions, re-transferring transferables (`ArrayBuffer`s, `OffscreenCanvas`, …) so nothing is copied.
2. **Lockdown.** A bootstrap blob runs `installWorkerLockdown()` *before* any application module is imported, deleting (or, where a property cannot be deleted, making access throw on) `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `BroadcastChannel`, `SharedWorker`, `importScripts`, `window`, `document`, `parent`, `top`, `frames` and `opener`. `self` is never touched, the function is idempotent, and it refuses to run against a window-like realm (anything with a `document`), so the same call is safe as a second line of defence inside the worker module.
3. **Message sanitization.** Every payload is parsed with a strict zod schema chosen for that worker's protocol, in *both* directions. Rejected payloads never cross the boundary; they are recorded as violations on the handle.

## Launch flow

`vite build`/`vite dev` transform (`enforce: 'post'`, i.e. after `vite:worker-import-meta-url` has turned `new URL('../workers/x.js', import.meta.url)` into a worker chunk URL):

```js
new Worker(new URL("../workers/zk-worker.js", import.meta.url), { type: "module" })
// becomes
import { createSandboxedWorker } from "/src/lib/workerSandbox.ts";
createSandboxedWorker(new URL("../workers/zk-worker.js", import.meta.url), { type: "module" })
```

The argument list is untouched, so Vite's worker chunking and `worker: { format: "es" }` keep working. `src/workers/**`, `test/**` and `node_modules/**` are excluded, and the transform is skipped entirely while `process.env.VITEST` is set (tests supply their own Worker doubles).

At runtime the handle resolves in this order:

1. Build the bootstrap (lockdown source + `import(workerUrl)`), create the sandboxed iframe, pass it the embedding document's CSP nonce (`srcdoc` documents inherit the parent's policy, so its inline script has to carry the nonce).
2. The frame mints the blob URL, creates the worker, and relays `hello`/`create`/`message`/`terminate` envelopes back and forth; both ends authenticate with a per-launch token and check `event.source`/`event.origin`.
3. Messages posted before the frame connects are queued (cap 64) and flushed once it is ready.
4. The worker posts `__helphone: 'boot'` after the lockdown runs; the handle marks the worker booted and clears the boot timer. Control messages are consumed by the handle and never reach `onmessage`.

## Violation codes

| Code | Meaning |
| --- | --- |
| `inbound-schema` | A message *to* the worker failed its protocol schema; dropped |
| `outbound-schema` | A message *from* the worker failed its protocol schema; dropped |
| `boot-failure` | Frame error, missing boot handshake, or the bootstrap could not import the worker module |
| `frame-timeout` | The opaque transport did not become ready in time |
| `queue-overflow` | More than 64 messages were posted while connecting (oldest dropped) |
| `transport-error` | The relay threw while posting |

Violations are exposed as `handle.violations` (and through `onViolation`); without a handler they are logged with a `[worker-sandbox]` prefix.

## Degradation

Opaque isolation costs something in restricted environments, so it fails *open to a weaker but still protected* configuration rather than breaking the worker:

- frame unavailable, frame never connects, boot handshake missing, or the module graph is not CORS-readable → **same-origin blob worker** (lockdown + sanitization still apply), with a `frame-timeout` / `boot-failure` violation and a console warning;
- `origin: "same-origin"` skips the iframe by design;
- `origin: "opaque"` (or `fallbackToSameOrigin: false`) never degrades — it surfaces the failure through `onerror` instead.

## Production deployment notes

The sandbox is fully functional under `npm run dev` and `npm run preview`, where the plugin also answers `Origin: null` fetches with `Access-Control-Allow-Origin: null` for non-`/api` GETs. Two deployment knobs are required for the opaque path to work behind the production CSP/server:

- **Static assets need `Access-Control-Allow-Origin: null`** (or `*`). An opaque-origin worker fetches its module graph as a cross-origin CORS request; without the header the import fails, the bootstrap reports `boot-error`, and the handle degrades to same-origin.
- **`script-src` is evaluated against the worker's origin.** For a `blob:null/...` worker the inherited `'self'` is the null origin, so the inherited production policy can reject the module import for the same reason. Serving the app without that inheritance (or with an explicit source for the worker entry) keeps opaque mode enabled; otherwise the automatic same-origin fallback keeps the app working.

Known trade-offs: an opaque worker reports `crossOriginIsolated === false`, so `zk-worker.getThreadCount()` falls back to one thread (slower proving — pass `origin: "same-origin"` to that launch site if threaded proving matters more than isolation); and `frame-src` is not needed for the frame, because the frame document is created from `srcdoc` rather than navigated to a URL.

## Design decisions

**The parent never talks to the worker directly in opaque mode.** A `blob:null/...` URL can only be resolved inside the frame that minted it, so the iframe owns the `Worker` and the parent only ever sees relayed messages. The relay is what keeps `transfer` semantics intact on both hops.

**Schemas live with the protocol, not the call site.** `selectWorkerSchemas()` picks the boundary from the emitted worker file name (`zk-worker*` → zk, `clusterWorker*` → cluster, everything else → generic), so a renamed chunk still gets a sanitizer and a test can assert exactly which protocol enforced a rejection. The two in-scope workers validate on their side too — defence in depth, and it keeps a future same-origin launch just as strict.

**The lockdown is stringified, not imported.** It has to run before any application code, from a blob that cannot resolve imports, so it may not reference module scope. That constraint is enforced by construction (and by `buildWorkerBootstrap`'s source assertions).

**Schema failures drop the payload rather than the worker.** A malformed message is a bug or an attack on one boundary, not a reason to tear down the prover; every drop is counted on the handle so callers can see them.

**The rewrite is masked text substitution, not a regex over raw source.** Comments and string literals are blanked (same length, same offsets) before searching, so documentation mentioning `new Worker(` cannot be rewritten, and the injected import is only added when the module does not already import the launcher.
