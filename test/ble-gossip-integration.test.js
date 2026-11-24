// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest'
import { generateEd25519Keypair } from '../src/lib/crypto.js'
import {
  BleStoreAndForwardRelay,
  getBlePlatformDisposition,
  signBeacon,
  encodeBeacon,
  fragmentMessage,
  DEFAULT_MTU,
} from '../src/lib/bleRelay.js'

describe('Issue #897: BLE proximity relay gossip integration', () => {
  const NOW_S = 1_800_000_000
  const NOW_MS = NOW_S * 1000
  let station
  let deviceA
  let deviceB

  const makeBeacon = (over = {}, kp = station) =>
    signBeacon(
      {
        v: 0,
        incidentId: 'incident-alpha',
        geohash: 'u4pruydqq',
        severity: 3,
        seq: 1,
        issuedAt: NOW_S,
        expiresAt: NOW_S + 300,
        note: 'severe structural collapse',
        ...over,
      },
      kp.publicKey,
      kp.secretKey
    )

  beforeEach(() => {
    station = generateEd25519Keypair()
    deviceA = new BleStoreAndForwardRelay({
      trustedSigners: [station.publicKey],
    })
    deviceB = new BleStoreAndForwardRelay({
      trustedSigners: [station.publicKey],
    })
  })

  describe('Two-device offline relay with bounded latency', () => {
    it('relays emergency request across two offline devices with bounded latency', async () => {
      const receivedAtDeviceB = []
      deviceB.onBeacon((beacon, hops) => {
        receivedAtDeviceB.push({ beacon, hops })
      })

      // Wire virtual BLE channel between Device A and Device B
      deviceA.registerPeer({
        id: 'device-b',
        send: (fragment) => {
          // Device B processes incoming fragment
          deviceB.processFragment(fragment, 'device-a', NOW_MS, 1)
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

      const startTime = Date.now()
      const forwarded = await deviceA.forwardPending(NOW_MS)
      const elapsedMs = Date.now() - startTime

      expect(forwarded).toBeGreaterThan(0)
      expect(receivedAtDeviceB.length).toBe(1)
      expect(receivedAtDeviceB[0].beacon.incidentId).toBe('incident-alpha')
      expect(receivedAtDeviceB[0].beacon.severity).toBe(3)
      expect(receivedAtDeviceB[0].hops).toBe(1)
      // Latency is bounded (under 500ms target for relay reassembly & gate evaluation)
      expect(elapsedMs).toBeLessThan(500)
    })
  })

  describe('Duplicate delivery prevention', () => {
    it('guarantees 0 duplicate delivery when duplicate fragments or beacons are relayed', async () => {
      const delivered = []
      deviceB.onBeacon((beacon) => {
        delivered.push(beacon)
      })

      const beacon = makeBeacon({ seq: 42 })
      const frags = fragmentMessage(encodeBeacon(beacon), DEFAULT_MTU)

      // Send the same fragments multiple times simulating multipath echoes
      for (let i = 0; i < 3; i++) {
        for (const frag of frags) {
          deviceB.processFragment(frag, 'peer-multipath', NOW_MS)
        }
      }

      expect(delivered.length).toBe(1)
      expect(delivered[0].seq).toBe(42)
    })
  })

  describe('Store-and-forward queue with TTL expiry', () => {
    it('evicts expired beacons from store-and-forward queue during forwarding', async () => {
      const beacon = makeBeacon({
        seq: 5,
        issuedAt: NOW_S - 200,
        expiresAt: NOW_S - 10, // Already expired
      })

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

      let transmittedFragments = 0
      deviceA.registerPeer({
        id: 'peer-sink',
        send: () => {
          transmittedFragments++
          return true
        },
      })

      const forwarded = await deviceA.forwardPending(NOW_MS)
      expect(forwarded).toBe(0)
      expect(transmittedFragments).toBe(0)
    })
  })

  describe('Integration with SyncManager / Dispatch layer', () => {
    it('dispatches incoming verified beacons into SyncManager with ble-trickle bearer', () => {
      const dispatchedOps = []
      const mockSyncManager = {
        dispatch: async (op) => {
          dispatchedOps.push(op)
          return { stored: true, outbox: false }
        },
      }

      deviceA.integrateWithSyncManager(mockSyncManager)

      const beacon = makeBeacon({ seq: 99, incidentId: 'evac-sector-4' })
      const frags = fragmentMessage(encodeBeacon(beacon), DEFAULT_MTU)
      for (const frag of frags) {
        deviceA.processFragment(frag, 'peer-field', NOW_MS)
      }

      expect(dispatchedOps.length).toBe(1)
      expect(dispatchedOps[0].incidentId).toBe('evac-sector-4')
      expect(dispatchedOps[0].bearer).toBe('ble-trickle')
      expect(dispatchedOps[0].type).toBe('incident-beacon')
    })
  })

  describe('Platform disposition and graceful no-BLE fallback', () => {
    it('identifies iOS as unsupported with graceful fallback to gateway/wi-fi without throwing', () => {
      const iosDisposition = getBlePlatformDisposition({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      })
      expect(iosDisposition.supported).toBe(false)
      expect(iosDisposition.platform).toBe('ios')
      expect(iosDisposition.reason).toContain('unsupported on iOS')
    })

    it('identifies Android Chrome capabilities and foreground requirement', () => {
      const androidDisposition = getBlePlatformDisposition({
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)',
        bluetooth: {},
      })
      expect(androidDisposition.supported).toBe(true)
      expect(androidDisposition.platform).toBe('android')
      expect(androidDisposition.hasBackgroundScan).toBe(false)
    })

    it('gracefully handles complete absence of bluetooth API on desktop/node', () => {
      const fallback = getBlePlatformDisposition({})
      expect(fallback.supported).toBe(false)
      expect(fallback.platform).toBe('desktop')
    })
  })
})
