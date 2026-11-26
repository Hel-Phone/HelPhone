import React, { useState } from 'react'
import { generateLocationProof, buildLocationProofZone } from '../../lib/zk'
import ProvenanceBadge from '../../components/ProvenanceBadge.jsx'

export interface ZkCheckpointModuleProps {
  requestId: string
  location?: { lat: number; lng: number }
  onProofGenerated?: (proof: any) => void
}

export const ZkCheckpointModule: React.FC<ZkCheckpointModuleProps> = ({
  requestId,
  location,
  onProofGenerated,
}) => {
  const [proof, setProof] = useState<any>(null)
  const [generating, setGenerating] = useState(false)

  const handleGenerateProof = async () => {
    if (!location) return
    setGenerating(true)
    try {
      const zone = buildLocationProofZone(location)
      const p = await generateLocationProof(zone, requestId)
      setProof(p)
      onProofGenerated?.(p)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div>
      <button onClick={handleGenerateProof} disabled={generating || !location}>
        {generating ? 'Generating...' : 'Generate Location Proof'}
      </button>
      {proof && <ProvenanceBadge />}
    </div>
  )
}
