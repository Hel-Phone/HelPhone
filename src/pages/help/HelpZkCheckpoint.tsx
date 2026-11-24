import React from 'react'

export interface HelpZkCheckpointProps {
  passkeyAuthEnabled: boolean
  passkeyVerified: boolean
  onAuthenticatePasskey: () => Promise<void>
}

/**
 * Decomposed Help Feature Module: ZK & WebAuthn Passkey Checkpoint (#900).
 * Handles cryptographic authorization and identity verification.
 */
export function HelpZkCheckpoint({
  passkeyAuthEnabled,
  passkeyVerified,
  onAuthenticatePasskey,
}: HelpZkCheckpointProps) {
  if (!passkeyAuthEnabled) return null

  return (
    <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
      <h3>Passkey Cryptographic Authorization</h3>
      <button
        type="button"
        onClick={onAuthenticatePasskey}
        style={{
          background: passkeyVerified ? '#3F8487' : '#FF7A6B',
          color: '#fff',
          border: 'none',
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          cursor: 'pointer',
          fontWeight: 'bold',
        }}
      >
        {passkeyVerified ? '✅ Passkey Verified (P-256)' : '🔑 Authenticate Passkey (P-256)'}
      </button>
    </div>
  )
}

export default HelpZkCheckpoint
