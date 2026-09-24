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

## License compliance gate (#586)

- Script: `scripts/license-compliance.js` scans npm (`package-lock.json`) and
  Cargo (`cargo metadata`) licenses and evaluates SPDX expressions. CI fails
  on strong copyleft (GPL/AGPL/SSPL/…) that isn't listed in
  `LICENSE_EXCEPTIONS`.
- `npm run security:license-gate` runs the same check as CI.
  `npm run licenses:generate` regenerates `licenses.json`.
- Policy, exception process and triage: `docs/legal-compliance.md`.

## CVE patch bot (#599)

- Script: `scripts/auto-patch-cve.js`. It reads GitHub Security Advisories,
  either through `npm audit` (the default, backed by the GitHub Advisory DB)
  or the GitHub REST `/advisories?affects=` API (`--source github`). It then
  plans the **minimum** fixed version for every vulnerable `name@version` in
  the lockfile: the lowest published, non-deprecated, non-prerelease version
  that no known advisory matches, preferring the same major.
- Strategy:
  - For a direct dependency, the bot bumps the range in `package.json` or
    `server/package.json` and keeps the existing `^`/`~` style.
  - For a transitive dependency, it writes a root `overrides` floor
    (`"pkg": "^fixed"`) when every installed copy is on the fixed major.
    Otherwise it writes a version-keyed override (`"pkg@1.2.3": "1.2.4"`) so
    copies on other majors stay untouched.
  - Fixes that need a major bump are listed for a human. Pass `--allow-major`
    to apply them.
- Modes:
  - `npm run security:cve-patch` prints the plan only.
  - `npm run security:cve-patch:apply` writes the manifests, runs
    `npm install`, confirms that the lockfile and `npm audit` no longer report
    the patched advisories, then runs every `--verify <cmd>` (default
    `npm test`). If any step fails, it restores `package.json`,
    `server/package.json` and `package-lock.json`.
  - `--open-pr` also commits the change on `security/cve-patch-*`, pushes it,
    and opens a PR with the advisory table, verification results and the
    follow-up list.
- Automation: `.github/workflows/cve-patch-bot.yml` runs weekly and on
  manual dispatch. PRs opened with `GITHUB_TOKEN` don't trigger CI, so set a
  `CVE_BOT_TOKEN` secret (fine-grained PAT or GitHub App) to get checks on
  bot PRs. CI's `supply-chain` job runs the plan in report-only mode and fails
  only on critical advisories.
- Triage for a bot PR:
  1. Review the advisory links.
  2. Check that the version moves are patch or minor.
  3. Merge.
  4. Handle "Needs manual follow-up" items as separate PRs, for example a
     dependency upgrade that removes the vulnerable package.

## Maintainer key revocation & web of trust (#619)

- Script: `scripts/security/verify_maintainer_keys.js`, configured by
  `config/maintainer-keys.json`. It verifies OpenPGP signatures on commits
  (`--range`), annotated tags (`--tags <glob>`) and release artifacts
  (`--artifact f --signature f.asc`) in-process. It includes an RFC 4880
  parser and uses node:crypto for RSA, EdDSA and ECDSA, so no gpg is needed.
- Revocation data is live. Keys are fetched from keys.openpgp.org and
  keyserver.ubuntu.com, merged, and cached in `.cache/maintainer-keys/` for
  `cacheTtlHours`. `--refresh` forces a refetch and `--offline` uses the cache
  only. Revocation certificates are verified cryptographically, so a forged
  one is ignored.
- Revocation rules (RFC 4880 §5.2.3.23):

  | Reason | Signatures before the revocation | Signatures after |
  | --- | --- | --- |
  | 0x02 key compromised / 0x00 no reason | **invalid** | invalid |
  | 0x01 superseded / 0x03 retired | valid | invalid |

  This is the case the tool exists for. A release signed *before* anyone
  discovered that the key was compromised still fails.
- Web of trust: a signer is trusted when it is a `trustedKeys` root, or when
  it has at least `minCertifications` valid, unrevoked certifications from a
  root. Certifications from a root that was itself revoked as compromised
  don't count. The roots are the GitHub web-flow keys, which cover merges made
  in the UI; add maintainer keys as the team adopts signing.
- `dependencies[]` pins critical upstream maintainers' key fingerprints
  (`{ "name", "fingerprints": [...] }`). `--pinned` checks each key against
  the live revocation lists:
  - compromised: FAIL (re-verify every release that key signed)
  - superseded: WARN (pin the successor key)
- Gates:
  - Bad signatures, compromised keys and revoked trusted roots always fail.
  - Unsigned, unknown-key, untrusted and SSH-signed objects warn, and fail
    under `--strict`.
- Where it runs:
  - CI `supply-chain`: PR commit range.
  - `verify-keys.yml`: pushes, release tags, and a nightly `--refresh` sweep
    of every `v*` tag and all pinned keys.
  - `slsa-provenance.yml`: before release builds. Set the repository variable
    `REQUIRE_SIGNED_RELEASES=true` to make release tags `--strict`.
- If it fails on a compromised key:
  1. Freeze releases.
  2. Identify every artifact signed by that fingerprint (the `signer` field in
     `--json` output).
  3. Rebuild and re-sign them with a fresh key.
  4. Rotate `trustedKeys` / `dependencies[]`.
