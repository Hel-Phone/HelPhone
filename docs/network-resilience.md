# Network Resilience Testing

`tests/e2e/throttling.spec.ts` drives Chromium through the Chrome DevTools Protocol (CDP) to check that HelPhone behaves under the network conditions its users actually have during an emergency: slow mobile data, a capped connection, and no connection at all.

## Profiles

| Profile | Download | Upload | Latency | Source |
| --- | --- | --- | --- | --- |
| `2g` | 50 kbps | 20 kbps | 500 ms | Chrome DevTools "GPRS" preset |
| `3g` | 400 kbps | 400 kbps | 400 ms | Chrome DevTools "Slow 3G" preset |
| `cap-500kbps` | 500 kbps | 500 kbps | 50 ms | The 500 kbps bandwidth cap from the SLA |
| `offline` | none | none | n/a | `Network.emulateNetworkConditions { offline: true }` |

CDP takes throughput in bytes per second, so the spec converts with `kbps * 1024 / 8`.

## What is asserted

- **The throttle is real.** A request cannot complete faster than the emulated latency or the bandwidth cap allows. Without this, a silently ineffective throttle would make every other test pass vacuously.
- **Requests queue, not fail.** Five concurrent requests under each throttled profile all resolve successfully.
- **The app stays usable.** A full navigation under each throttled profile reaches the landing content, and no offline banner appears while the connection is merely slow.
- **Offline indicator.** Going offline shows the alert banner (`OfflineIndicator`, mounted globally in `src/main.tsx`); reconnecting hides it. A page checked with `context.setOffline` reports `navigator.onLine === false`.
- **Fail fast, then recover.** While offline a request rejects with a `TypeError` in under 5 seconds instead of hanging, and succeeds again once the network returns.

The throttling project is separate from the default one (`playwright.config.js`) because slow-network navigations need a 180 s timeout and would otherwise slow the whole e2e suite.

## Running

```bash
npm run test:e2e:throttling                        # all profiles
npm run test:e2e:throttling -- --grep "\[2g\]"     # one profile
```

CDP network emulation is Chromium-only, so the spec skips other browsers.

## CI

The `e2e-throttling` job in `.github/workflows/ci.yml` runs one matrix leg per profile (`2g`, `3g`, `cap-500kbps`, `offline`) with `fail-fast` off, so a regression names the network class it breaks on and one failing leg does not hide the others. Traces are uploaded on failure.

## Known limits

- The suite measures behaviour, not a page-load SLA number. A hard time budget for a full page load under 500 kbps depends on bundle size and CI runner speed. Add one once a baseline has been recorded from real CI runs.
- "Requests queue gracefully" is asserted for same-origin fetches from the page. It does not yet cover the wallet or Stellar RPC calls, which need a test network.
