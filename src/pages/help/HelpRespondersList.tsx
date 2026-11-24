import React from 'react'

export interface HelpRespondersListProps {
  walletConnected: boolean
  walletAddress?: string
  recipientCount: number | null
  onConnectWallet: () => void
}

/**
 * Decomposed Help Feature Module: Nearby Responders & Wallet Connection (#900).
 */
export function HelpRespondersList({
  walletConnected,
  walletAddress,
  recipientCount,
  onConnectWallet,
}: HelpRespondersListProps) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      {walletConnected ? (
        <p style={{ color: '#7357FF', fontWeight: 600 }}>Connected Wallet: {walletAddress}</p>
      ) : (
        <button
          type="button"
          onClick={onConnectWallet}
          style={{
            background: '#7357FF',
            color: '#fff',
            border: 'none',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            marginBottom: '1rem',
            fontWeight: 600,
          }}
        >
          Connect Stellar Wallet
        </button>
      )}

      {recipientCount !== null && (
        <p style={{ fontSize: '0.82rem', color: '#3F8487', marginTop: '0.6rem' }}>
          Sealed for {recipientCount} key{recipientCount === 1 ? '' : 's'} (you plus every
          registered responder).
        </p>
      )}
    </div>
  )
}

export default HelpRespondersList
