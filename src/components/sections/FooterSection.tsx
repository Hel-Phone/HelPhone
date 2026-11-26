import React from 'react'
import { colors, spacing } from '../../theme/tokens'

export interface FooterSectionProps {
  withLinks?: boolean
}

export const FooterSection: React.FC<FooterSectionProps> = ({ withLinks = true }) => (
  <footer
    style={{
      background: colors.background,
      borderTop: `1px solid ${colors.borderSubtle}`,
      padding: `${spacing.sectionPadBottom} 2rem`,
      textAlign: 'center',
      color: colors.muted,
      fontSize: '0.9rem',
    }}
  >
    <p>© 2026 HelPhone. Emergency Response Network.</p>
    {withLinks && (
      <div style={{ marginTop: '1rem', display: 'flex', gap: spacing.linkGap, justifyContent: 'center' }}>
        <a href="/privacy" style={{ color: colors.teal, textDecoration: 'none' }}>
          Privacy
        </a>
        <a href="/terms" style={{ color: colors.teal, textDecoration: 'none' }}>
          Terms
        </a>
      </div>
    )}
  </footer>
)
