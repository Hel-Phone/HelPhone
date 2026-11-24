import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { createPartialResponse } from "workbox-range-requests";
import { AssetManager } from "./lib/assetManager.ts";

cleanupOutdatedCaches();

const assetManager = new AssetManager();

const manifest = self.__WB_MANIFEST || [];
precacheAndRoute(manifest);

const CACHE_NAME = "helphone-v1";
const TILES_CACHE_VERSION = "v1";
const TILES_CACHE_NAME = `tiles-${TILES_CACHE_VERSION}`;
const ALLOWED_TILE_MIMES = [
  "application/x-protobuf",
  "application/vnd.mapbox-vector-tile",
  "application/octet-stream",
  "image/png",
  "image/webp",
  "image/jpeg",
];

// ISP-092 / #898: Integrity metrics tracker for PWA cache defense
const integrityMetrics = {
  quarantinedCount: 0,
  repairedCount: 0,
  opaqueRejectedCount: 0,
  mimeMismatchCount: 0,
  oversizedCount: 0,
  integrityViolations: 0,
};

function recordIntegrityViolation(type, details = {}) {
  integrityMetrics.integrityViolations++;
  if (type === "STATUS_OPAQUE") integrityMetrics.opaqueRejectedCount++;
  if (type === "MIME_MISMATCH") integrityMetrics.mimeMismatchCount++;
  if (type === "OVERSIZED") integrityMetrics.oversizedCount++;
  if (type === "QUARANTINED") integrityMetrics.quarantinedCount++;

  self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    for (const c of clients) {
      c.postMessage({ type: "INTEGRITY_ANOMALY", violation: type, details, metrics: { ...integrityMetrics } });
    }
  }).catch(() => {});
}

async function notifyQuotaPressure(stats) {
  try {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of clients) {
      c.postMessage({ type: "QUOTA_PRESSURE", stats, degraded: Boolean(stats?.pressured) });
    }
  } catch {
    // ignore client broadcast errors
  }
}

async function evictTileOrEphemeralCaches() {
  await assetManager.evictUnderPressure();
  const tileCache = await caches.open(TILES_CACHE_NAME).catch(() => null);
  if (tileCache) {
    const keys = await tileCache.keys();
    for (const k of keys.slice(0, Math.min(10, keys.length))) {
      await tileCache.delete(k);
    }
  }
}

async function safeCachePut(cache, request, response, tier = "frequent") {
  try {
    const blob = await response.clone().blob();
    const url = typeof request === "string" ? request : request.url;
    const priority = tier === "critical" ? 0 : tier === "frequent" ? 1 : 2;
    await assetManager.cacheAsset(
      { url, size: blob.size, type: tier, hash: "", priority },
      blob,
    );
    await cache.put(request, response);
  } catch (err) {
    if (err && (err.name === "QuotaExceededError" || /quota/i.test(String(err.message)))) {
      await evictTileOrEphemeralCaches();
      const stats = await assetManager.getStatsPublic();
      await notifyQuotaPressure(stats);
      if (tier === "critical") {
        try {
          await cache.put(request, response);
        } catch {
          // Critical asset still held in AssetManager persistent tier
        }
      }
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ISP-046: Precache critical locale files for offline i18n support
      // Ensures Arabic Help form renders offline without suspense hang
      return cache.addAll([
        '/locales/en/common.json',
        '/locales/en/help.json',
        '/locales/ar/common.json',
        '/locales/ar/help.json',
      ]).then(() => {
        self.skipWaiting();
      });
    }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== CACHE_NAME &&
            cacheName !== "helphone-zk-assets-v1" &&
            cacheName !== TILES_CACHE_NAME
          ) {
            return caches.delete(cacheName);
          }
        }),
      );
    }).then(() => {
      self.clients.claim();
    })
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // #742: Skip caching for HMR and dev server requests to avoid stale-while-revalidate
  if (
    url.searchParams.has("t") || // Vite HMR timestamp query
    /\/@vite\//.test(url.pathname) || // Vite HMR module
    /\.hmr(?:\.json)?$/.test(url.pathname) // HMR manifest
  ) {
    return; // Let fetch proceed normally, don't cache
  }

  if (
    request.method === "GET" &&
    url.origin === self.location.origin &&
    /\/zk-assets\/aegis\.chunk\d{4}$/.test(url.pathname)
  ) {
    event.respondWith((async () => {
      const cache = await caches.open("helphone-zk-assets-v1");
      const key = new Request(url.href, { method: "GET" });
      let full = await cache.match(key);
      if (!full) {
        full = await fetch(key);
        if (full.ok) await safeCachePut(cache, key, full.clone(), "critical");
      }
      if (!request.headers.has("range") || !full.ok) return full;
      try {
        return await createPartialResponse(request, full);
      } catch {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${full.headers.get("content-length") || 0}` } });
      }
    })());
    return;
  }

  const isNavigation =
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/";

  if (isNavigation) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResponse = await fetch(request);

          // #898: Strict navigation response validation (reject opaque responses & corrupted stubs)
          if (!networkResponse || networkResponse.status === 0) {
            recordIntegrityViolation("STATUS_OPAQUE", { url: request.url });
            const cached = await cache.match(request) || await caches.match("/");
            if (cached) return cached;
            return networkResponse;
          }

          if (networkResponse.status === 200) {
            const contentType = (networkResponse.headers.get("content-type") || "")
              .split(";")[0]
              .trim()
              .toLowerCase();

            if (contentType.includes("text/html")) {
              await safeCachePut(cache, request, networkResponse.clone(), "critical");
              return networkResponse;
            } else {
              recordIntegrityViolation("MIME_MISMATCH", { url: request.url, contentType });
            }
          }
          const cached = await cache.match(request) || await caches.match("/");
          return cached || networkResponse;
        } catch {
          const cached = await cache.match(request) || await caches.match("/");
          return cached || new Response("Offline - HelPhone emergency shell ready", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
      })()
    );
    return;
  }

  if (request.method === "GET") {
    if (url.hostname.includes("mapbox.com")) {
      event.respondWith(
        (async () => {
          const cache = await caches.open(TILES_CACHE_NAME);
          const cachedResponse = await cache.match(request);

          const revalidatePromise = (async () => {
            try {
              const networkResponse = await fetch(request);
              // #898: Strict tile integrity verification
              // 1. Opaque response (status 0) rejection
              if (!networkResponse || networkResponse.status === 0) {
                recordIntegrityViolation("STATUS_OPAQUE", { url: request.url });
                return cachedResponse || networkResponse;
              }

              // 2. Reject non-200 HTTP statuses
              if (networkResponse.status !== 200) {
                return cachedResponse || networkResponse;
              }

              // 3. Upstream revocation check
              const isRevoked = networkResponse.headers.get("x-tile-revoke");
              if (isRevoked === "true" || isRevoked === "1") {
                recordIntegrityViolation("QUARANTINED", { url: request.url, reason: "revocation" });
                await cache.delete(request);
                const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
                clients.forEach((c) => c.postMessage({ type: "TILE_REVOKED", url: request.url }));
                return cachedResponse || networkResponse;
              }

              // 4. MIME type check
              const contentType = (networkResponse.headers.get("content-type") || "")
                .split(";")[0]
                .trim()
                .toLowerCase();
              const isAllowedMime = ALLOWED_TILE_MIMES.some(
                (m) => contentType === m || contentType.includes("protobuf") || contentType.includes("vector-tile")
              );

              // 5. Size check: reject oversized > 1MB or undersized stub < 40B
              const contentLength = parseInt(networkResponse.headers.get("content-length") || "0", 10);
              const isOversized = contentLength > 1024 * 1024;
              const isUndersized = contentLength > 0 && contentLength < 40;

              if (isAllowedMime && !isOversized && !isUndersized) {
                await safeCachePut(cache, request, networkResponse.clone(), "frequent");
                integrityMetrics.repairedCount++;
              } else {
                const reason = isOversized ? "OVERSIZED" : isUndersized ? "UNDERSIZED" : "MIME_MISMATCH";
                recordIntegrityViolation(reason, { url: request.url, contentType, contentLength });
                // Quarantine: delete poisoned response from cache
                await cache.delete(request);
              }
              return networkResponse;
            } catch (err) {
              if (cachedResponse) return cachedResponse;
              throw err;
            }
          })();

          if (cachedResponse) {
            event.waitUntil(revalidatePromise.catch(() => {}));
            return cachedResponse;
          }

          return revalidatePromise;
        })()
      );
      return;
    }

    if (
      request.url.endsWith(".wasm") ||
      request.url.endsWith(".mp4") ||
      request.url.endsWith(".webm") ||
      request.url.endsWith(".json")
    ) {
      const tier = request.url.endsWith(".json") ? "ephemeral" : "critical";
      event.respondWith(
        caches.match(request).then((response) => {
          return (
            response ||
            fetch(request).then((response) => {
              const responseClone = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                void safeCachePut(cache, request, responseClone, tier);
              });
              return response;
            })
          );
        }),
      );
      return;
    }
  }

  event.respondWith(
    fetch(request).catch(() => {
      return caches.match(request).then((response) => {
        return (
          response ||
          new Response(
            JSON.stringify({
              message: "Offline",
              description:
                "You are currently offline. Some features may not be available.",
            }),
            {
              status: 503,
              statusText: "Service Unavailable",
              headers: { "Content-Type": "application/json" },
            },
          )
        );
      });
    }),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};

  if (data.type === "GET_ASSET_STATS") {
    event.waitUntil(
      assetManager.getStatsPublic().then((stats) => {
        if (event.source && typeof event.source.postMessage === "function") {
          event.source.postMessage({ type: "ASSET_STATS", stats, degraded: Boolean(stats.pressured) });
        }
      }),
    );
    return;
  }

  // CRDT sync: forward the local state change to the backend sync endpoint,
  // delaying background sync if storage quota is under pressure.
  if (data.type === "CRDT_SYNC") {
    event.waitUntil(
      (async () => {
        const stats = await assetManager.getStatsPublic();
        if (stats.pressured) {
          await notifyQuotaPressure(stats);
          await new Promise((resolve) => setTimeout(resolve, stats.criticalPressured ? 5_000 : 1_500));
        }
        await fetch("/api/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data.payload),
        });
      })(),
    );
  }

  // Contract update events and CRDT/state sync (issue #516): reflect the
  // message to every other open window client so a single leader's poll or
  // SSE result reaches all tabs without each tab owning a subscription.
  if (data.type === "CONTRACT_EVENT" || data.type === "CRDT_SYNC" || data.type === "STATE_SYNC") {
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          return Promise.all(
            clients.map((client) => {
              if (client === event.source) return Promise.resolve();
              return client.postMessage({ ...data, source: data.source || "service-worker" });
            }),
          );
        })
        .catch(() => {}),
    );
  }

  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  // ISP-092: Emergency purge for poisoned Mapbox vector tiles without wiping app-shell
  if (data.type === "PURGE_TILES") {
    event.waitUntil(
      caches
        .keys()
        .then((cacheNames) => {
          const tileCaches = cacheNames.filter(
            (name) =>
              name.startsWith("tiles-") ||
              name.includes("mapbox-tiles") ||
              name.includes("mapbox-api")
          );
          return Promise.all(tileCaches.map((name) => caches.delete(name)));
        })
        .then(() => {
          return self.clients.matchAll({ type: "window", includeUncontrolled: true });
        })
        .then((clients) => {
          for (const client of clients) {
            client.postMessage({ type: "TILES_PURGED", timestamp: Date.now() });
          }
        })
    );
  }

  // #898: Query live cache integrity metrics
  if (data.type === "GET_INTEGRITY_METRICS") {
    if (event.source && typeof event.source.postMessage === "function") {
      event.source.postMessage({
        type: "INTEGRITY_METRICS_RESPONSE",
        metrics: { ...integrityMetrics },
        timestamp: Date.now(),
      });
    }
  }

  // #898: Selective cache repair protocol without full manual cache reset
  if (data.type === "REPAIR_CACHE") {
    event.waitUntil(
      (async () => {
        const target = data.target || "tiles";
        if (target === "tiles") {
          const tileCache = await caches.open(TILES_CACHE_NAME);
          const keys = await tileCache.keys();
          // Evict any keys marked as invalid or purge and trigger fresh revalidation
          for (const k of keys) {
            if (data.url && k.url === data.url) {
              await tileCache.delete(k);
            }
          }
          integrityMetrics.repairedCount++;
        }
        const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const c of clients) {
          c.postMessage({ type: "CACHE_REPAIRED", target, metrics: { ...integrityMetrics } });
        }
      })()
    );
  }

  // ISP-135/ISP-134: the SW can never hold a Serial port or NDEFReader, so
  // it only relays field intents (radio RX, NFC results, SOS) between
  // clients. TX always happens in a foreground page.
  if (event.data && event.data.type === "HELPHONE_RELAY") {
    event.waitUntil(
      self.clients
        .matchAll({ includeUncontrolled: true, type: "window" })
        .then((clientList) => {
          for (const client of clientList) {
            client.postMessage(event.data);
          }
        }),
    );
  }
});
