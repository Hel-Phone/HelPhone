import React from 'react'
import CommunityMap from '../../components/CommunityMap'

export interface MapMarker {
  id: string
  lat: number
  lng: number
}

export interface MapModuleProps {
  mode: 'get' | 'offer'
  userLocation?: [number, number]
  markers?: MapMarker[]
  onMarkerClick?: (marker: MapMarker) => void
}

export const MapModule: React.FC<MapModuleProps> = ({ mode, userLocation, markers = [], onMarkerClick }) => (
  <div style={{ width: '100%', height: '500px', borderRadius: '8px', overflow: 'hidden' }}>
    <CommunityMap />
  </div>
)
