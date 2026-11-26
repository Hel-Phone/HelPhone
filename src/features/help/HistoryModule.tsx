import React, { useState, useEffect } from 'react'
import { restoreDraft } from '../../lib/crashRecovery.ts'

export interface HistoryModuleProps {
  userId: string
  onSelectRequest?: (req: any) => void
}

export const HistoryModule: React.FC<HistoryModuleProps> = ({ userId, onSelectRequest }) => {
  const [history, setHistory] = useState<any[]>([])

  useEffect(() => {
    const draft = restoreDraft()
    if (draft) setHistory([draft])
  }, [userId])

  return (
    <div>
      <h3>Recent Requests</h3>
      {history.length === 0 ? (
        <p>No history</p>
      ) : (
        <ul>
          {history.map((req, i) => (
            <li key={i} onClick={() => onSelectRequest?.(req)} style={{ cursor: 'pointer' }}>
              {req.type} · {new Date(req.createdAt || Date.now()).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
