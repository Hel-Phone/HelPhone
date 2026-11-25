import React, { useState } from 'react'
import { RequestFormModule, type HelpRequest } from '../features/help/RequestFormModule'
import { ResponderTrackerModule } from '../features/help/ResponderTrackerModule'
import { MapModule } from '../features/help/MapModule'
import { ZkCheckpointModule } from '../features/help/ZkCheckpointModule'
import { HistoryModule } from '../features/help/HistoryModule'
import { createRequest } from '../lib/contract'

export const Help: React.FC = () => {
  const [mode, setMode] = useState<'get' | 'offer'>('get')
  const [currentRequest, setCurrentRequest] = useState<HelpRequest | null>(null)

  const handleRequestSubmit = async (req: HelpRequest) => {
    const tx = await createRequest(req)
    setCurrentRequest(tx)
    setMode('offer')
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem', padding: '2rem' }}>
      <aside>
        {mode === 'get' ? (
          <>
            <RequestFormModule onSubmit={handleRequestSubmit} />
            <HistoryModule userId="user1" onSelectRequest={setCurrentRequest} />
          </>
        ) : (
          <ResponderTrackerModule requestId={currentRequest?.id || ''} />
        )}
      </aside>
      <main>
        <MapModule mode={mode} />
        {mode === 'get' && <ZkCheckpointModule requestId={currentRequest?.id || ''} />}
      </main>
    </div>
  )
}
