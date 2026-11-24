import React from 'react'
import { colors, spacing } from '../../theme/tokens'

export interface FeatureItem {
  id: string
  title: string
  description: string
  icon: string
}

export interface FeaturesSectionProps {
  revealIndex?: number
  visible?: boolean
  features?: FeatureItem[]
}

const DEFAULT_FEATURES: FeatureItem[] = [
  {
    id: 'offline-crdt',
    title: 'Offline-First CRDT Sync',
    description: 'Autonomous incident state replication across mesh peers with Conflict-Free Replicated Data Types.',
    icon: '⚡',
  },
  {
    id: 'ble-mesh',
    title: 'BLE Proximity Relay',
    description: 'Life-safety beacon gossip over Bluetooth Low Energy when all cell towers and Wi-Fi networks go dark.',
    icon: '📡',
  },
  {
    id: 'priority-dispatch',
    title: 'Fair Priority Dispatch',
    description: 'Anti-starvation queueing engine ensuring life-threatening triage alerts (P0) bypass congestion.',
    icon: '🚨',
  },
  {
    id: 'webrtc-audio',
    title: 'P2P Emergency Audio',
    description: 'Resilient WebRTC audio streaming directly between field responders and dispatch commanders.',
    icon: '🎙️',
  },
]

/**
 * Strangler slice (Order 5): Features section (#899).
 * Tokenized colors, typed props, reveal contract, zero inline hex colors.
 */
export function FeaturesSection({
  revealIndex = 3,
  visible = true,
  features = DEFAULT_FEATURES,
}: FeaturesSectionProps) {
  return (
    <section
      data-slice="features"
      data-reveal={revealIndex}
      data-visible={visible ? '1' : '0'}
      style={{
        paddingTop: spacing.sectionPadBottom,
        paddingBottom: spacing.sectionPadBottom,
        maxWidth: '1200px',
        margin: '0 auto',
        paddingLeft: '1.5rem',
        paddingRight: '1.5rem',
        opacity: visible ? 1 : 0.35,
        transition: 'opacity 400ms ease',
      }}
    >
      <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: 'clamp(1.5rem, 5vw, 2.25rem)', color: colors.cream, marginBottom: '0.75rem' }}>
          Mission-Critical Resilient Capabilities
        </h2>
        <p style={{ color: colors.muted, maxWidth: '650px', margin: '0 auto', fontSize: '1.1rem' }}>
          Engineered for extreme disaster environments where conventional infrastructure fails.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {features.map((feat) => (
          <div
            key={feat.id}
            className="hp-feature-card"
            style={{
              background: colors.navGlass,
              border: `1px solid ${colors.borderSubtle}`,
              borderRadius: '0.75rem',
              padding: '1.5rem',
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>{feat.icon}</div>
            <h3 style={{ fontSize: '1.2rem', color: colors.cream, marginBottom: '0.5rem' }}>{feat.title}</h3>
            <p style={{ color: colors.muted, fontSize: '0.95rem', lineHeight: 1.5 }}>{feat.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default FeaturesSection
