import React, { useState, useEffect } from 'react'

export interface Responder {
  id: string
  name: string
  rating: number
}

export interface ResponderTrackerModuleProps {
  requestId: string
  onResponderSelect?: (responder: Responder) => void
}

export const ResponderTrackerModule: React.FC<ResponderTrackerModuleProps> = ({
  requestId,
  onResponderSelect,
}) => {
  const [responders, setResponders] = useState<Responder[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(false)
  }, [requestId])

  return (
    <div>
      <h3>Active Responders</h3>
      {loading ? (
        <p>Loading responders...</p>
      ) : responders.length === 0 ? (
        <p>No responders available</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
          {responders.map((r) => (
            <div
              key={r.id}
              onClick={() => onResponderSelect?.(r)}
              style={{
                padding: '1rem',
                border: '1px solid #ccc',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              <strong>{r.name}</strong>
              <p>Rating: {r.rating}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
