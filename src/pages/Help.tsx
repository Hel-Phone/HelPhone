import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useFeatureFlag } from '../lib/featureFlags.js'
import { passkeyManager } from '../lib/passkey.js'
import { useWallet } from '../contexts/WalletContext.js'
import { useLocationSearch } from '../hooks/useLocationSearch.js'
import {
  buildResponderKeyRecords,
  decryptEmergencyPayload,
  encryptEmergencyPayload,
  exportPrivateKeyJwk,
  exportPublicKeyHex,
  generateEncryptionKeyPair,
  importPrivateKeyJwk,
  MAX_PAYLOAD_PLAINTEXT_BYTES,
} from '../lib/crypto.js'
import { api } from '../services/api.js'
import { emergencyAudioAlert } from '../lib/audioAlert.js'
import {
  HelpMapSection,
  HelpRequestForm,
  HelpRespondersList,
  HelpZkCheckpoint,
  HelpHistorySection,
} from './help'

/** Where a responder's sealed private key is stashed, per Stellar address. */
const RESPONDER_KEY_PREFIX = 'hp_responder_e2ee_v1:'

interface ResponderKeyState {
  publicKey: string
  privateKey: CryptoKey
}

/**
 * Load (or create) this wallet's responder encryption key.
 */
async function loadOrCreateResponderKey(wallet: string): Promise<ResponderKeyState> {
  const storageKey = `${RESPONDER_KEY_PREFIX}${wallet}`
  const stored = sessionStorage.getItem(storageKey)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { jwk: JsonWebKey; publicKey: string }
      return {
        publicKey: parsed.publicKey,
        privateKey: await importPrivateKeyJwk(parsed.jwk),
      }
    } catch {
      sessionStorage.removeItem(storageKey)
    }
  }
  const pair = await generateEncryptionKeyPair()
  const publicKey = await exportPublicKeyHex(pair.publicKey)
  const jwk = await exportPrivateKeyJwk(pair.privateKey)
  sessionStorage.setItem(storageKey, JSON.stringify({ jwk, publicKey }))
  void api.registerDispatchKey(wallet, publicKey)
  return { publicKey, privateKey: pair.privateKey }
}

export default function Help() {
  const passkeyAuthEnabled = useFeatureFlag('passkey_authentication')
  const encryptedDispatchEnabled = useFeatureFlag('encrypted_dispatch')
  const { walletState, connectWallet } = useWallet()
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [passkeyVerified, setPasskeyVerified] = useState<boolean>(false)
  const [contact, setContact] = useState<string>('')
  const [medicalNotes, setMedicalNotes] = useState<string>('')
  const [recipientCount, setRecipientCount] = useState<number | null>(null)
  const [revealed, setRevealed] = useState<{ requestId: string; contact: string; medicalNotes: string } | null>(
    null
  )
  const [revealError, setRevealError] = useState<string>('')

  const {
    location,
    searchQuery,
    setSearchQuery,
    searchError,
    searchSuggestions,
    selectSearchSuggestion,
    handleSearchKeyDown,
  } = useLocationSearch({ mapboxToken: '' })
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false
  const hasOfflineMatch = searchSuggestions.some(
    (s: any) => s?.properties?.offline === true,
  )

  const handlePasskeyAuth = async () => {
    try {
      setStatusMessage('Authenticating with WebAuthn Passkey...')
      const credential = await passkeyManager.authenticatePasskey()

      if (credential) {
        const verification = await passkeyManager.verifyAssertion(credential)
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

  const handleSealAndDispatch = useCallback(async () => {
    if (!walletState.address) {
      setRevealError('Connect your Stellar wallet first.')
      return
    }
    if (!contact.trim() && !medicalNotes.trim()) {
      setRevealError('Add a contact number or a medical note to seal.')
      return
    }
    setRevealError('')

    try {
      const own = await loadOrCreateResponderKey(walletState.address)
      const registry = await api.getDispatchRecipientKeys()
      const keys = registry.success && registry.keys?.length ? registry.keys : []

      const recipients = await buildResponderKeyRecords([
        { wallet: walletState.address, publicKey: own.publicKey },
        ...keys.map((k) => ({ wallet: k.wallet, publicKey: k.publicKey })),
      ])
      setRecipientCount(recipients.length)

      const requestId = `local-${Date.now()}`
      const envelope = await encryptEmergencyPayload(
        { contact: contact.trim(), medicalNotes: medicalNotes.trim(), nickname: '' },
        recipients.map((r) => r.publicKey),
        requestId
      )
      const stored = await api.storeDispatchEnvelope(requestId, envelope)
      if (!stored.success) {
        setRevealError(`Relay refused the envelope: ${stored.error ?? 'unknown error'}`)
        return
      }

      const back = await decryptEmergencyPayload(envelope, own.privateKey, requestId)
      setRevealed({ requestId, contact: back.contact, medicalNotes: back.medicalNotes })
      setStatusMessage('🔒 Payload sealed end-to-end. Only your key and the responders’ can open it.')
    } catch (err: any) {
      setRevealError(err?.message || 'Could not seal the emergency payload.')
    }
  }, [walletState.address, contact, medicalNotes])

  const plaintextBytes = new TextEncoder().encode(
    JSON.stringify({ contact, medicalNotes, nickname: '' })
  ).length
  const overBudget = plaintextBytes > MAX_PAYLOAD_PLAINTEXT_BYTES

  useEffect(() => emergencyAudioAlert.armOnFirstGesture(), [])

  const handleTestSiren = async () => {
    try {
      const outcome = await emergencyAudioAlert.play()
      setStatusMessage(
        outcome === 'played'
          ? 'Emergency siren preview played.'
          : 'Your browser is blocking sound. Tap the page once, then try again; vibration was used instead.'
      )
    } catch (err: any) {
      setStatusMessage(err.message || 'Unable to play the emergency siren.')
    }
  }

  return (
    <div
      style={{
        background: '#1c2c24',
        color: '#ECE0CC',
        minHeight: '100vh',
        padding: 'clamp(1rem, 4vw, 2rem)',
        boxSizing: 'border-box',
        overflowX: 'hidden',
      }}
    >
      <header style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ color: '#FF7A6B', textDecoration: 'none', fontWeight: 'bold' }}>
          ← Back to HelPhone Home
        </Link>
        <h1 style={{ fontSize: 'clamp(1.5rem, 6vw, 2.5rem)', marginTop: '1rem' }}>
          Emergency Dispatch Request
        </h1>
      </header>

      <div
        style={{
          background: '#234B4E',
          padding: 'clamp(1.25rem, 5vw, 2rem)',
          borderRadius: '1rem',
          maxWidth: '600px',
          width: '100%',
          boxSizing: 'border-box',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        <h2>Submit Emergency Alert</h2>
        <p style={{ color: '#a2a586' }}>
          Broadcast encrypted location and incident report to nearby community responders.
        </p>
        <button
          type="button"
          onClick={handleTestSiren}
          aria-label="Play emergency siren preview"
          style={{
            background: '#FF7A6B',
            color: '#1c2c24',
            border: 'none',
            padding: '0.65rem 1rem',
            borderRadius: '0.5rem',
            cursor: 'pointer',
            fontWeight: 'bold',
            marginBottom: '1rem',
          }}
        >
          Test emergency siren
        </button>

        {/* Feature Module 1: Map & Location Search (#900) */}
        <HelpMapSection
          location={location}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          searchSuggestions={searchSuggestions}
          isOffline={isOffline}
          hasOfflineMatch={hasOfflineMatch}
          searchError={searchError}
          handleSearchKeyDown={handleSearchKeyDown}
          selectSearchSuggestion={selectSearchSuggestion}
        />

        {/* Feature Module 2: Responders List & Wallet Connection (#900) */}
        <HelpRespondersList
          walletConnected={walletState.isConnected}
          walletAddress={walletState.address}
          recipientCount={recipientCount}
          onConnectWallet={connectWallet}
        />

        {/* Feature Module 3: ZK & Passkey Checkpoint (#900) */}
        <HelpZkCheckpoint
          passkeyAuthEnabled={passkeyAuthEnabled}
          passkeyVerified={passkeyVerified}
          onAuthenticatePasskey={handlePasskeyAuth}
        />

        {/* Feature Module 4: Encrypted Request Form (#900) */}
        <HelpRequestForm
          encryptedDispatchEnabled={encryptedDispatchEnabled}
          contact={contact}
          setContact={setContact}
          medicalNotes={medicalNotes}
          setMedicalNotes={setMedicalNotes}
          plaintextBytes={plaintextBytes}
          overBudget={overBudget}
          revealError={revealError}
          onSealAndDispatch={handleSealAndDispatch}
        />

        {/* Feature Module 5: Decrypted History & Status Alerts (#900) */}
        <HelpHistorySection
          revealed={revealed}
          statusMessage={statusMessage}
        />
      </div>
    </div>
  )
}
