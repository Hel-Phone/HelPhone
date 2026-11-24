/**
 * Production validation test suite for assigned issues #897, #898, #899, #900.
 * Uses native node:test runner for zero-dependency hermetic execution.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Issue #897 imports
import {
  BleStoreAndForwardRelay,
  getBlePlatformDisposition,
  signBeacon,
  encodeBeacon,
  fragmentMessage,
  DEFAULT_MTU,
} from '../src/lib/bleRelay.ts'
import { generateEd25519Keypair } from '../src/lib/crypto.ts'

// Issue #899 imports
import {
  SLICE_ORDER,
  NavSection,
  HeroSection,
  FooterSection,
  TrustSection,
  FeaturesSection,
  MapSection,
} from '../src/components/sections/index.ts'
import { colors, motion } from '../src/theme/tokens.ts'

// Issue #900 imports
import {
  HelpMapSection,
  HelpRequestForm,
  HelpRespondersList,
  HelpZkCheckpoint,
  HelpHistorySection,
  HelpShadowHarness,
} from '../src/pages/help/index.ts'

// Issue #898 imports
import {
  TileCacheIntegrityManager,
  CacheQuarantineManager,
} from '../server/lib/tileCacheIntegrity.js'

test('Issue #897: BLE Proximity Relay Gossip Integration', async (t) => {
  const station = generateEd25519Keypair()
  const NOW_S = 1_800_000_000
  const NOW_MS = NOW_S * 1000

  const makeBeacon = (over = {}) =>
    signBeacon(
      {
        v: 0,
        incidentId: 'incident-gamma',
        geohash: 'u4pruydqq',
        severity: 3,
        seq: 1,
        issuedAt: NOW_S,
        expiresAt: NOW_S + 300,
        note: 'high priority triage',
        ...over,
      },
      station.publicKey,
      station.secretKey
    )

  await t.test('relays request across two offline devices with bounded latency', async () => {
    const deviceA = new BleStoreAndForwardRelay({ trustedSigners: [station.publicKey] })
    const deviceB = new BleStoreAndForwardRelay({ trustedSigners: [station.publicKey] })

    const receivedAtDeviceB = []
    deviceB.onBeacon((b, hops) => receivedAtDeviceB.push({ beacon: b, hops }))

    deviceA.registerPeer({
      id: 'device-b',
      send: (frag) => {
        deviceB.processFragment(frag, 'device-a', NOW_MS, 1)
        return true
      },
    })

    const beacon = makeBeacon({ seq: 1 })
    deviceA.originateBeacon(
      {
        v: beacon.v,
        incidentId: beacon.incidentId,
        geohash: beacon.geohash,
        severity: beacon.severity,
        seq: beacon.seq,
        issuedAt: beacon.issuedAt,
        expiresAt: beacon.expiresAt,
        note: beacon.note,
      },
      station.publicKey,
      station.secretKey,
      NOW_MS
    )

    const start = Date.now()
    const forwarded = await deviceA.forwardPending(NOW_MS)
    const elapsed = Date.now() - start

    assert.ok(forwarded > 0, 'Should forward fragments')
    assert.equal(receivedAtDeviceB.length, 1)
    assert.equal(receivedAtDeviceB[0].beacon.incidentId, 'incident-gamma')
    assert.equal(receivedAtDeviceB[0].hops, 1)
    assert.ok(elapsed < 500, `Latency ${elapsed}ms is bounded under 500ms`)
  })

  await t.test('guarantees 0 duplicate delivery across redundant transmissions', async () => {
    const device = new BleStoreAndForwardRelay({ trustedSigners: [station.publicKey] })
    const delivered = []
    device.onBeacon((b) => delivered.push(b))

    const beacon = makeBeacon({ seq: 101 })
    const frags = fragmentMessage(encodeBeacon(beacon), DEFAULT_MTU)

    for (let i = 0; i < 4; i++) {
      for (const frag of frags) {
        device.processFragment(frag, 'peer-mesh', NOW_MS)
      }
    }

    assert.equal(delivered.length, 1, 'Should dedup repeated fragments/beacons')
    assert.equal(delivered[0].seq, 101)
  })

  await t.test('evicts expired beacons from store-and-forward queue (TTL enforcement)', async () => {
    const device = new BleStoreAndForwardRelay({ trustedSigners: [station.publicKey] })
    const expiredBeacon = makeBeacon({
      seq: 200,
      issuedAt: NOW_S - 400,
      expiresAt: NOW_S - 50, // expired
    })

    device.originateBeacon(
      {
        v: expiredBeacon.v,
        incidentId: expiredBeacon.incidentId,
        geohash: expiredBeacon.geohash,
        severity: expiredBeacon.severity,
        seq: expiredBeacon.seq,
        issuedAt: expiredBeacon.issuedAt,
        expiresAt: expiredBeacon.expiresAt,
        note: expiredBeacon.note,
      },
      station.publicKey,
      station.secretKey,
      NOW_MS
    )

    let sent = 0
    device.registerPeer({
      id: 'peer-test',
      send: () => {
        sent++
        return true
      },
    })

    const forwarded = await device.forwardPending(NOW_MS)
    assert.equal(forwarded, 0, 'Expired beacon must not be forwarded')
    assert.equal(sent, 0)
  })

  await t.test('graceful no-BLE fallback for iOS and unsupported platforms', () => {
    const ios = getBlePlatformDisposition({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
    })
    assert.equal(ios.supported, false)
    assert.equal(ios.platform, 'ios')
    assert.ok(ios.reason.includes('unsupported on iOS'))

    const desktopNoBle = getBlePlatformDisposition({})
    assert.equal(desktopNoBle.supported, false)
  })
})

test('Issue #899: Complete src/App.tsx Strangler Slices', async (t) => {
  await t.test('marks slices 1 through 6 as extracted and keeps help planned-last', () => {
    const expected = ['nav', 'hero', 'footer', 'trust', 'features', 'map']
    for (const id of expected) {
      const slice = SLICE_ORDER.find((s) => s.id === id)
      assert.ok(slice, `Slice ${id} should exist`)
      assert.equal(slice.status, 'extracted', `Slice ${id} should be marked extracted`)
    }

    const helpSlice = SLICE_ORDER.find((s) => s.id === 'help')
    assert.ok(helpSlice)
    assert.equal(helpSlice.status, 'planned-last')
    assert.equal(SLICE_ORDER.at(-1)?.id, 'help')
  })

  await t.test('tokenizes all colors with zero inline hex regressions in src/components/sections/', () => {
    assert.equal(colors.coral, '#FF7A6B')
    assert.equal(colors.cream, '#ECE0CC')
    assert.equal(colors.background, '#1c2c24')
    assert.equal(motion.revealFallbackMs, 4500)

    const sectionsDir = join(process.cwd(), 'src', 'components', 'sections')
    const files = readdirSync(sectionsDir).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))

    const hexRegex = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

    for (const file of files) {
      const content = readFileSync(join(sectionsDir, file), 'utf8')
      const matches = content.match(hexRegex) || []
      assert.deepEqual(
        matches,
        [],
        `File src/components/sections/${file} contains hardcoded hex: ${matches.join(', ')}`
      )
    }
  })

  await t.test('exports all 6 section components as functions', () => {
    assert.equal(typeof NavSection, 'function')
    assert.equal(typeof HeroSection, 'function')
    assert.equal(typeof FooterSection, 'function')
    assert.equal(typeof TrustSection, 'function')
    assert.equal(typeof FeaturesSection, 'function')
    assert.equal(typeof MapSection, 'function')
  })
})

test('Issue #900: Decompose Help.jsx into Feature Modules', async (t) => {
  await t.test('exports all decomposed feature modules and shadow harness', () => {
    assert.equal(typeof HelpMapSection, 'function')
    assert.equal(typeof HelpRequestForm, 'function')
    assert.equal(typeof HelpRespondersList, 'function')
    assert.equal(typeof HelpZkCheckpoint, 'function')
    assert.equal(typeof HelpHistorySection, 'function')
    assert.equal(typeof HelpShadowHarness, 'function')
  })
})

test('Issue #898: PWA Cache Poisoning & Tile Integrity Defenses', async (t) => {
  const manager = new TileCacheIntegrityManager({ version: '1' })
  const quarantineManager = new CacheQuarantineManager()

  await t.test('strictly rejects opaque navigation responses (status 0)', () => {
    const res = manager.validateNavigationResponse({
      status: 0,
      url: 'https://helphone.com/',
      headers: {},
    })
    assert.equal(res.valid, false)
    assert.equal(res.code, 'STATUS_OPAQUE')
  })

  await t.test('rejects non-HTML navigation responses (captive portal / spoof)', () => {
    const res = manager.validateNavigationResponse({
      status: 200,
      url: 'https://helphone.com/',
      headers: { 'content-type': 'application/json' },
      bodySize: 1000,
    })
    assert.equal(res.valid, false)
    assert.equal(res.code, 'MIME_MISMATCH')
  })

  await t.test('accepts valid HTML navigation responses', () => {
    const res = manager.validateNavigationResponse({
      status: 200,
      url: 'https://helphone.com/',
      headers: { 'content-type': 'text/html; charset=utf-8' },
      bodySize: 3200,
    })
    assert.equal(res.valid, true)
  })

  await t.test('quarantines poisoned tile entries and tracks observable metrics', async () => {
    const deleted = []
    const mockCache = {
      delete: async (req) => {
        deleted.push(req)
        return true
      },
    }

    const entry = await quarantineManager.quarantine(
      mockCache,
      'https://api.mapbox.com/v4/poison.vector.pbf',
      'Corrupted payload',
      'STATUS_OPAQUE'
    )

    assert.equal(entry.code, 'STATUS_OPAQUE')
    assert.equal(deleted.length, 1)

    const metrics = quarantineManager.getMetrics()
    assert.equal(metrics.quarantinedCount, 1)
    assert.equal(metrics.opaqueRejectedCount, 1)
    assert.equal(metrics.integrityViolations, 1)
  })

  await t.test('provides safe auto-repair path with fallback for non-fatal P0 UI', async () => {
    const fallback = { status: 200, payload: 'offline-safe-tile' }
    const result = await quarantineManager.repair(
      null,
      'https://api.mapbox.com/v4/tile.vector.pbf',
      fallback
    )

    assert.equal(result.repaired, true)
    assert.equal(result.isFallback, true)
    assert.equal(quarantineManager.getMetrics().repairedCount, 1)
  })
})
