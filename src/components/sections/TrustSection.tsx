import React from 'react'
import { colors, spacing } from '../../theme/tokens'

interface TrustCard {
  title: string
  metric: string
}

const TRUST_CARDS: TrustCard[] = [
  { title: 'Response Time', metric: '<90s avg' },
  { title: 'Network Coverage', metric: '99.4%' },
  { title: 'User Verified', metric: '50K+' },
]

export const TrustSection: React.FC = () => (
  <section style={{ padding: spacing.sectionPadBottom, background: colors.background }}>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2rem' }}>
      {TRUST_CARDS.map((card) => (
        <div key={card.title} style={{ padding: '1rem', borderRadius: '8px' }}>
          <h3 style={{ color: colors.coral, marginBottom: '0.5rem' }}>{card.title}</h3>
          <p style={{ fontSize: '1.5rem', color: colors.purple, margin: 0 }}>{card.metric}</p>
        </div>
      ))}
    </div>
  </section>
)
