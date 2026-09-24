import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFeatureFlag } from '../lib/featureFlags.js'
import { passkeyManager } from '../lib/passkey.js'
import { useWallet } from '../contexts/WalletContext.js'

export default function Help() {
  const passkeyAuthEnabled = useFeatureFlag('passkey_authentication')
  const { walletState, connectWallet } = useWallet()
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [passkeyVerified, setPasskeyVerified] = useState<boolean>(false)

  const handlePasskeyAuth = async () => {
    try {
      setStatusMessage('Authenticating with WebAuthn Passkey...')
      const challenge = passkeyManager.generateChallenge()
      const credential = await passkeyManager.authenticatePasskey(challenge)

      if (credential) {
        const verification = await passkeyManager.verifyAssertion(credential, challenge)
        if (verification.verified) {
          setPasskeyVerified(true)
          setStatusMessage('✅ Passkey authenticated successfully! Emergency broadcast authorized.')
        } else {
          setStatusMessage(`❌ Passkey verification failed: ${verification.error}`)
        }
      }
    } catch (err: any) {
      setStatusMessage(`Passkey sign-in: ${err.message}`)
    }
  }

  return (
    <div style={{ background: '#1c2c24', color: '#ECE0CC', minHeight: '100vh', padding: '2rem' }}>
      <header style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ color: '#FF7A6B', textDecoration: 'none', fontWeight: 'bold' }}>
          ← Back to HelPhone Home
        </Link>
        <h1 style={{ fontSize: '2.5rem', marginTop: '1rem' }}>Emergency Dispatch Request</h1>
      </header>

      <div
        style={{
          background: '#234B4E',
          padding: '2rem',
          borderRadius: '1rem',
          maxWidth: '600px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        <h2>Submit Emergency Alert</h2>
        <p style={{ color: '#a2a586' }}>
          Broadcast encrypted location and incident report to nearby community responders.
        </p>

        {walletState.isConnected ? (
          <p style={{ color: '#7357FF' }}>Connected Wallet: {walletState.address}</p>
        ) : (
          <button
            onClick={() => connectWallet()}
            style={{
              background: '#7357FF',
              color: '#fff',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '0.5rem',
              cursor: 'pointer',
              marginBottom: '1rem',
            }}
          >
            Connect Stellar Wallet
          </button>
        )}

        {passkeyAuthEnabled && (
          <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
            <h3>Passkey Cryptographic Authorization</h3>
            <button
              onClick={handlePasskeyAuth}
              style={{
                background: '#FF7A6B',
                color: '#fff',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '0.5rem',
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              🔑 Authenticate Passkey (P-256)
            </button>
          </div>
        )}

        {statusMessage && (
          <p style={{ marginTop: '1.5rem', padding: '1rem', background: '#1c2c24', borderRadius: '0.5rem' }}>
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  )
}
