# HelPhone

HelPhone is a React + Vite community emergency response application built on Stellar. It combines wallet-gated help requests, Soroban smart contracts, local ZK privacy proofs, WebAuthn Passkeys, and automated contract storage state backups.

---

## Technical Subsystems & Architecture

### 1. Soroban Storage Inspection & State Snapshot Dumps
- **CLI Exporter**: `scripts/export-contract-state.sh` extracts complete contract storage dumps using `stellar contract inspect` or JSON-RPC queries.
- **Node.js/TypeScript Exporter**: `server/indexer/exporter.ts` indexes storage entries into versioned JSON snapshots (`./snapshots/snapshot-<ledgerSeq>.json`).
- **Automated Backup Cron**: `server/index.ts` automatically runs daily state export tasks to back up contract storage.
- **Disaster Recovery Runbook**: See [`docs/disaster-recovery.md`](docs/disaster-recovery.md) for state restoration procedures.

### 2. Automated Pre-Commit Code Quality Pipeline
- **Husky & lint-staged**: Intercepts `git commit` via `.husky/pre-commit` to automatically run linters and type-checkers on staged files.
- **Quality Verification**:
  - `npm run lint` (`eslint .`) - Code style & quality checks.
  - `npm run typecheck` (`tsc --noEmit`) - Strict TypeScript validation without building output.
  - `npm test` - Vitest test suite execution.
- **GitHub Actions CI**: `.github/workflows/ci.yml` enforces quality, linting, type-checking, state export verification, and crypto matrix tests on all pull requests and pushes.

### 3. Dynamic Feature Canary Rollouts & State Evaluation
- **Feature Flag Engine**: `src/lib/featureFlags.ts` evaluates feature flag toggles dynamically.
- **Remote Config**: Fetches rulesets from `/config.json` without requiring application rebuilds.
- **Percentage Hashing**: Deterministically hashes user IDs / device IDs for 0-100% canary rollouts.
- **React Hook Integration**: Components use `useFeatureFlag('flag_name')` for conditional rendering.

### 4. Cross-Layer Signature Verification Testing Suite
- **Cryptographic Suite**: `src/lib/crypto.ts` provides Ed25519 signature verification, WebAuthn P-256 (ECDSA SHA-256) parsing, and AES-256-GCM encryption/decryption.
- **Passkey Manager**: `src/lib/passkey.ts` handles browser WebAuthn credential registration and authentication.
- **Auth Middleware**: `server/middleware/auth.ts` enforces anti-replay timestamp freshness and cryptographic header verification.
- **Test Matrix**: `test/crypto-verification.test.js` covers positive & negative boundary tests (tampered payload, invalid key, expired signature).

### 5. Performance, Storage Security & Network Resilience
- **HTTP Keep-Alive**: `server/middleware/keepAlive.ts` holds sockets open for 65 s (above the balancer's 60 s idle timeout) so sequential API and WebSocket traffic reuses one TCP connection. See [`docs/performance-optimization.md`](docs/performance-optimization.md).
- **Map Overlay Rendering**: `src/lib/offscreenCanvas.ts` + `src/workers/canvas-worker.js` animate map markers in a Web Worker via OffscreenCanvas, with a main-thread fallback and measured FPS. See [`docs/performance-optimization.md`](docs/performance-optimization.md).
- **Client Storage Encryption**: `src/lib/pbkdf2Key.ts` + `src/lib/secureStorage.ts` derive an AES-256-GCM key via PBKDF2 (100k iterations, per-device salt in IndexedDB) to encrypt local data. See [`docs/security-architecture.md`](docs/security-architecture.md).
- **Network Resilience Testing**: `tests/e2e/throttling.spec.ts` emulates 2G, 3G, a 500 kbps cap, and offline via CDP, with a CI matrix leg per profile. See [`docs/network-resilience.md`](docs/network-resilience.md).

### 6. Supply Chain Security & License Auditor (#540)
- **Auditor**: `scripts/audit-deps.js` audits `package-lock.json` and `server/package-lock.json` (zero dependencies, offline) and fails CI on unauthorized copyleft licenses (GPL/AGPL/SSPL/EUPL/OSL/CPAL/RPL not in `scripts/security/license_policy.js` `EXCEPTIONS`), unlisted or suspicious install scripts, and hijack indicators (untrusted registry host, `http://`/git sources, missing or non-sha512 integrity).
- **Report**: a deterministic `licenses.json`; `npm run security:audit-deps` regenerates it and `npm run security:audit-deps:check` (CI) fails when it is stale.
- **Runbook**: [docs/security-runbook.md](docs/security-runbook.md).
- **Tests**: `test/dep-audit.test.js`.

### 7. Build Pipeline Egress Monitoring & Data Exfiltration Prevention
- **Monitor**: `scripts/monitor-build-egress.sh` wraps a build command (`npm run build` by default) with a packet capture (`tcpdump`, or `iptables` LOG/REJECT when running as root) and classifies every observed destination — tcpdump `src > dst` lines, iptables `DST=` log lines, and DNS query names.
- **Unauthorized Connection Gate**: loopback/RFC1918/CGNAT plus a curated registry allowlist (npm, GitHub, PyPI, crates.io, Node.js) are permitted; anything else — including cloud metadata endpoints (`169.254.169.254`) — fails the build with exit code 1. `--enforce` additionally REJECTs the connection through an `iptables` `OUTPUT` chain while the build runs.
- **Egress Audit Logs**: `egress-capture.log` (raw packets), `egress-audit.log` (per-destination verdicts) and `egress-summary.log` are written to `artifacts/build-egress/` and uploaded as CI artifacts for security review.
- **CI Gate**: the `build-egress-monitor` job in `.github/workflows/ci.yml` runs installation and the production build inside the monitor in `--strict` mode (fails when capture is unavailable or unauthorized egress is seen).
- **Runbook**: [docs/security-runbook.md](docs/security-runbook.md).
- **Tests**: `test/egress-detector.test.js`.

### 8. Automated Dependency Version Drift & Breaking API Change Analyzer
- **Analyzer**: `scripts/detect-api-drift.js` extracts the exported type surface of every protected package — functions, interfaces, class members, call signatures and `export =` modules — from its `.d.ts` entry point with the TypeScript Compiler API, then diffs the installed surface against the reviewed baseline committed in `package.json` → `apiDrift.baseline`. Signatures are normalized (whitespace, `import("…")` specifiers rewritten to their `node_modules/` form) so the same package produces byte-identical baselines on CI runners and developer machines.
- **Version Pinning Guard**: dropped or re-typed signatures are *breaking*, new exports are *additive*. A breaking diff inside a semver-compatible (same/minor/patch) upgrade fails with exit 1 and names the version to pin; a breaking diff in a major upgrade is reported as a warning and needs a re-baseline. When a package does not bundle its own declarations the drift is classified with the `@types/<pkg>` version, so an `@types` minor bump that breaks call sites is caught too.
- **Exact Pin Opt-In**: `npm run security:api-drift:pin` (`--require-exact-pin`) additionally fails protected dependencies declared as `^` / `~` / `>=` instead of an exact `1.2.3`.
- **Rust half**: `Cargo.toml` → `[workspace.metadata.api-drift]` (`require-exact-pin`, `protected-crates`) is validated against `[workspace.dependencies]`, `[dependencies]` and `[dev-dependencies]`, where only `=1.2.3` counts as pinned (a bare `1.2.3` means `^1.2.3`).
- **Baselines**: `npm run security:api-drift:update` re-extracts and merges into `package.json` (root: cors, express, express-rate-limit, fuse.js, graphql, pg, react-dom; `server/package.json`: @stellar/stellar-sdk, @aztec/bb.js, @noir-lang/noir_js). Extraction options live in `tsconfig.json` → `apiDrift.compilerOptions`, deliberately outside `compilerOptions` so `tsc --noEmit` ignores them.
- **CI Gate**: the `api-drift-guard` job in `.github/workflows/ci.yml` installs with `npm ci --ignore-scripts`, runs `npm run security:api-drift` and `security:api-drift:server`, and uploads the drift report when it fails.
- **Tests**: `test/api-drift.test.js`.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run local development server & indexer
npm run dev

# Run code quality & type checking
npm run lint
npm run typecheck

# Run complete Vitest test suite
npm test

# Export Soroban contract storage state manually
npm run export:state
```

---

## Environment Variables

Configure `.env`:

```bash
VITE_MAPBOX_TOKEN=...
VITE_AEGIS_VAULT_ID=...
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CC325F37QW7N2F5M3QGHL4A4O7J2K9L0M1N2O3P4Q5R6S7T8U9V0
```

---

## Deployment & Infrastructure

- **Server Blueprint**: Managed via `render.yaml` with web service and daily snapshot cron jobs.
- **CI/CD Pipeline**: GitHub Actions workflow at `.github/workflows/ci.yml`.

## Lockfile integrity

`npm run security:lockfiles` compares every npm SHA-512 integrity value and
Cargo SHA-256 checksum with the official npm and crates.io registries. CI runs
the check before installation and fails on divergence. Use
`npm run security:lockfiles:offline` to validate checksum shape without
network access; it is not a substitute for the CI registry check.

## Safe dependency installation

Normal npm installs have lifecycle scripts disabled by `.npmrc`. Run
`npm run security:install` for the standard install and scan. If a reviewed
native dependency genuinely requires a build script, pass its exact package
name to `bash scripts/sandbox-install.sh <package>`; the rebuild runs in a
rootless, capability-dropped container with no network, no host home/SSH mount,
a read-only container root, and only the repository mounted writable.

## AI-generated code security

`npm run security:ai-code` parses JavaScript and TypeScript ASTs and fails on
hardcoded secrets, unsanitized request data at sensitive sinks, unsafe HTML,
dynamic code, swallowed errors, unauthenticated contract submissions, invalid
platform API signatures, and undeclared package imports. PRs containing
AI-generated logic must carry the `ai-generated` label; the CI
`security-review` environment then requires a human security reviewer.
