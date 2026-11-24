import React from 'react'
import { colors, spacing } from '../../theme/tokens'

export interface TrustCardItem {
  id: string
  title: string
  description: string
  badgeText: string
  badgeColor?: keyof typeof colors
}

export interface TrustSectionProps {
  revealIndex?: number
  visible?: boolean
  items?: TrustCardItem[]
}

const DEFAULT_TRUST_ITEMS: TrustCardItem[] = [
  {
    id: 'zk-proofs',
    title: 'Zero-Knowledge Privacy',
    description: 'Noir cryptographic circuits verify identity and location without leaking private home coordinates.',
    badgeText: 'NOIR ZK',
    badgeColor: 'purple',
  },
  {
    id: 'soroban-contracts',
    title: 'Soroban Smart Escrow',
    description: 'Decentralized automated state on Stellar ledger guarantees verifiable community treasury and auditability.',
    badgeText: 'STELLAR',
    badgeColor: 'teal',
  },
  {
    id: 'webauthn-passkeys',
    title: 'Hardware-Bound Passkeys',
    description: 'Cryptographic FIDO2/WebAuthn authenticators replace insecure passwords with biometric device security.',
    badgeText: 'WEBAUTHN',
    badgeColor: 'coral',
  },
]

/**
 * Strangler slice (Order 4): Trust section with tokenized cards (#899).
 * All styling strictly references tokens.ts with zero hardcoded inline hex colors.
 */
export function TrustSection({
  revealIndex = 2,
  visible = true,
  items = DEFAULT_TRUST_ITEMS,
}: TrustSectionProps) {
  return (
    <section
      data-slice="trust"
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
          Built for Uncompromising Trust & Privacy
        </h2>
        <p style={{ color: colors.muted, maxWidth: '650px', margin: '0 auto', fontSize: '1.1rem' }}>
          In emergency crisis situations, privacy and cryptographic certainty are life-safety requirements.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem',
        }}
      >
        {items.map((card) => {
          const badgeBg = card.badgeColor ? colors[card.badgeColor] : colors.purple
          return (
            <div
              key={card.id}
              className="hp-trust-card"
              style={{
                background: colors.navGlass,
                border: `1px solid ${colors.borderSubtle}`,
                borderRadius: '0.75rem',
                padding: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span
                  style={{
                    display: 'inline-block',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    background: badgeBg,
                    color: colors.white,
                    marginBottom: '1rem',
                  }}
                >
                  {card.badgeText}
                </span>
                <h3 style={{ fontSize: '1.3rem', color: colors.cream, marginBottom: '0.5rem' }}>{card.title}</h3>
                <p style={{ color: colors.muted, lineHeight: 1.5, fontSize: '0.95rem' }}>{card.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export default TrustSection
