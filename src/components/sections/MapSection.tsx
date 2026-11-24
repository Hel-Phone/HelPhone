import React from 'react'
import { Link } from 'react-router-dom'
import { colors, spacing } from '../../theme/tokens'

export interface MapSectionProps {
  revealIndex?: number
  visible?: boolean
  responderCount?: number
  incidentCount?: number
}

/**
 * Strangler slice (Order 6): Map preview section (#899).
 * Highlights live community map coverage and offers one-click navigation
 * to the full interactive emergency map. Zero inline hex.
 */
export function MapSection({
  revealIndex = 4,
  visible = true,
  responderCount = 128,
  incidentCount = 14,
}: MapSectionProps) {
  return (
    <section
      data-slice="map"
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
      <div
        style={{
          background: colors.navGlass,
          border: `1px solid ${colors.borderSubtle}`,
          borderRadius: '1rem',
          padding: '2.5rem',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
        }}
      >
        <span
          style={{
            fontSize: '0.8rem',
            color: colors.teal,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          Real-Time Proximity Network
        </span>
        <h2 style={{ fontSize: 'clamp(1.5rem, 5vw, 2.25rem)', color: colors.cream, marginTop: '0.5rem', marginBottom: '1rem' }}>
          Live Community Incident & Responder Map
        </h2>
        <p style={{ color: colors.muted, maxWidth: '600px', margin: '0 auto 1.5rem', fontSize: '1rem' }}>
          Locate nearest community responders, track live muster points, and synchronize offline field beacons.
        </p>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '2rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: colors.coral }}>{responderCount}+</div>
            <div style={{ fontSize: '0.85rem', color: colors.muted }}>Active Responders</div>
          </div>
          <div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: colors.teal }}>{incidentCount}</div>
            <div style={{ fontSize: '0.85rem', color: colors.muted }}>Active Dispatches</div>
          </div>
          <div>
            <div style={{ fontSize: '1.75rem', fontWeight: 'bold', color: colors.purple }}>100%</div>
            <div style={{ fontSize: '0.85rem', color: colors.muted }}>ZK Geofenced</div>
          </div>
        </div>

        <Link
          to="/help"
          style={{
            display: 'inline-block',
            background: colors.teal,
            color: colors.white,
            padding: '0.85rem 1.75rem',
            borderRadius: '0.5rem',
            textDecoration: 'none',
            fontWeight: 'bold',
            fontSize: '1rem',
          }}
        >
          Open Live Map
        </Link>
      </div>
    </section>
  )
}

export default MapSection
