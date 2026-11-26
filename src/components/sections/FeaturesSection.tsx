import React from 'react'
import { colors, spacing } from '../../theme/tokens'

interface Feature {
  id: string
  title: string
  description: string
}

const FEATURES: Feature[] = [
  { id: 'realtime', title: 'Real-time Dispatch', description: 'Instant responder matching' },
  { id: 'offline', title: 'Offline First', description: 'Works without connectivity' },
  { id: 'zk', title: 'Private Location', description: 'Zero-knowledge proofs' },
]

export const FeaturesSection: React.FC = () => (
  <section style={{ padding: spacing.sectionPadBottom }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
      {FEATURES.map((feature) => (
        <div
          key={feature.id}
          style={{
            padding: '1rem',
            border: `1px solid ${colors.borderSubtle}`,
            borderRadius: '8px',
          }}
        >
          <h4 style={{ color: colors.teal, marginBottom: '0.5rem' }}>{feature.title}</h4>
          <p style={{ color: colors.muted, margin: 0 }}>{feature.description}</p>
        </div>
      ))}
    </div>
  </section>
)
