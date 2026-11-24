import React from 'react'
import { MAX_PAYLOAD_PLAINTEXT_BYTES } from '../../lib/crypto.js'

export interface HelpRequestFormProps {
  encryptedDispatchEnabled: boolean
  contact: string
  setContact: (value: string) => void
  medicalNotes: string
  setMedicalNotes: (value: string) => void
  plaintextBytes: number
  overBudget: boolean
  revealError: string
  onSealAndDispatch: () => Promise<void>
}

/**
 * Decomposed Help Feature Module: Encrypted Request Form (#900).
 * Handles user contact inputs, medical notes, byte budget calculation,
 * and dispatch sealing triggers.
 */
export function HelpRequestForm({
  encryptedDispatchEnabled,
  contact,
  setContact,
  medicalNotes,
  setMedicalNotes,
  plaintextBytes,
  overBudget,
  revealError,
  onSealAndDispatch,
}: HelpRequestFormProps) {
  if (!encryptedDispatchEnabled) return null

  return (
    <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
      <h3>🔒 End-to-End Encrypted Details</h3>
      <p style={{ color: '#a2a586', fontSize: '0.9rem' }}>
        Your contact number and medical notes are sealed on this device with
        ECDH&nbsp;P-256 + AES-256-GCM. The ledger and our relay only ever store
        ciphertext, and the key never leaves your browser.
      </p>

      <label
        htmlFor="emergency-contact"
        style={{ display: 'block', margin: '0.75rem 0 0.3rem', fontWeight: 'bold', fontSize: '0.9rem' }}
      >
        Contact number or handle
      </label>
      <input
        id="emergency-contact"
        type="text"
        autoComplete="tel"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="+1 555 0100"
        style={{
          width: '100%',
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid rgba(255,255,255,0.25)',
          background: '#1c2c24',
          color: '#ECE0CC',
        }}
      />

      <label
        htmlFor="emergency-medical-notes"
        style={{ display: 'block', margin: '0.75rem 0 0.3rem', fontWeight: 'bold', fontSize: '0.9rem' }}
      >
        Medical notes (allergies, medications, conditions)
      </label>
      <textarea
        id="emergency-medical-notes"
        rows={3}
        value={medicalNotes}
        onChange={(e) => setMedicalNotes(e.target.value)}
        placeholder="Carries an epinephrine auto-injector."
        aria-describedby="emergency-medical-notes-budget"
        style={{
          width: '100%',
          padding: '0.75rem',
          borderRadius: '0.5rem',
          border: '1px solid rgba(255,255,255,0.25)',
          background: '#1c2c24',
          color: '#ECE0CC',
          resize: 'vertical',
        }}
      />
      <p
        id="emergency-medical-notes-budget"
        style={{ fontSize: '0.78rem', color: overBudget ? '#FF7A6B' : '#a2a586', margin: '0.3rem 0 0' }}
      >
        {plaintextBytes} / {MAX_PAYLOAD_PLAINTEXT_BYTES} bytes before encryption.
        {overBudget ? ' Too large to seal — shorten the notes.' : ''}
      </p>

      <button
        type="button"
        onClick={onSealAndDispatch}
        disabled={overBudget}
        style={{
          background: overBudget ? '#a2a586' : '#234B4E',
          color: '#ECE0CC',
          border: '1px solid rgba(255,255,255,0.25)',
          padding: '0.75rem 1.5rem',
          borderRadius: '0.5rem',
          cursor: overBudget ? 'not-allowed' : 'pointer',
          marginTop: '0.75rem',
          fontWeight: 'bold',
        }}
      >
        Seal &amp; dispatch encrypted
      </button>

      {revealError && (
        <p role="alert" style={{ fontSize: '0.85rem', color: '#FF7A6B', marginTop: '0.6rem' }}>
          {revealError}
        </p>
      )}
    </div>
  )
}

export default HelpRequestForm
