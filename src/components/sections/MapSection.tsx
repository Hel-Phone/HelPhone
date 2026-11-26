import React from 'react'
import { colors, spacing } from '../../theme/tokens'
import CommunityMap from '../CommunityMap'

export interface MapSectionProps {
  centerLat?: number
  centerLng?: number
}

export const MapSection: React.FC<MapSectionProps> = ({ centerLat = 0, centerLng = 0 }) => (
  <section style={{ padding: spacing.sectionPadBottom }}>
    <h2 style={{ color: colors.coral, marginBottom: '1rem' }}>Community Map</h2>
    <div style={{ height: '400px', borderRadius: '8px', overflow: 'hidden', background: colors.background }}>
      <CommunityMap />
    </div>
  </section>
)
