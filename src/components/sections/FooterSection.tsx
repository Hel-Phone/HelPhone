import React from 'react'
import { Link } from 'react-router-dom'
import { colors, spacing } from '../../theme/tokens'

export interface FooterSectionProps {
  revealIndex?: number
  visible?: boolean
  tagline?: string
  copyrightText?: string
}

/**
 * Strangler slice (Order 3): Footer section extracted from App.tsx (#899).
 * Fully tokenized colors via tokens.ts, typed props, zero inline hex colors.
 */
export function FooterSection({
  revealIndex = 5,
  visible = true,
  tagline = 'A community emergency network where the nearest hand finds you on the map.',
  copyrightText = '© 2026 HelPhone · Built for neighbours · Stellar & ZK Emergency Dispatch',
}: FooterSectionProps) {
  return (
    <footer
      data-slice="footer"
      data-reveal={revealIndex}
      data-visible={visible ? '1' : '0'}
      style={{
        borderTop: `1px solid ${colors.borderSubtle}`,
        background: colors.background,
        color: colors.cream,
        paddingTop: spacing.sectionPadBottom,
        paddingBottom: '2.5rem',
        marginTop: '3rem',
        opacity: visible ? 1 : 0.35,
        transition: 'opacity 400ms ease',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          paddingLeft: '1.5rem',
          paddingRight: '1.5rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: '2rem',
            marginBottom: '2.5rem',
          }}
        >
          <div style={{ maxWidth: '380px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: colors.coral,
                  display: 'inline-block',
                }}
              />
              <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: colors.coral }}>HelPhone</span>
            </div>
            <p style={{ color: colors.muted, lineHeight: 1.5, fontSize: '0.95rem' }}>{tagline}</p>
          </div>

          <div style={{ display: 'flex', gap: '3rem', flexWrap: 'wrap' }}>
            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: colors.teal,
                  marginBottom: '0.75rem',
                }}
              >
                PLATFORM
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <Link to="/" style={{ color: colors.muted, textDecoration: 'none', fontSize: '0.9rem' }}>
                  Home
                </Link>
                <Link to="/help" style={{ color: colors.muted, textDecoration: 'none', fontSize: '0.9rem' }}>
                  Emergency Help
                </Link>
                <Link to="/ranking" style={{ color: colors.muted, textDecoration: 'none', fontSize: '0.9rem' }}>
                  Responders
                </Link>
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: colors.purple,
                  marginBottom: '0.75rem',
                }}
              >
                SECURITY
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <span style={{ color: colors.muted, fontSize: '0.9rem' }}>Noir ZK Proofs</span>
                <span style={{ color: colors.muted, fontSize: '0.9rem' }}>Soroban Escrow</span>
                <span style={{ color: colors.muted, fontSize: '0.9rem' }}>BLE Proximity</span>
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            borderTop: `1px solid ${colors.borderSubtle}`,
            paddingTop: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            fontSize: '0.85rem',
            color: colors.muted,
          }}
        >
          <div>{copyrightText}</div>
          <div style={{ color: colors.coral }}>▤ help arrives through people</div>
        </div>
      </div>
    </footer>
  )
}

export default FooterSection
