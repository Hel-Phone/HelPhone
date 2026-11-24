import React from 'react'
import { sanitizeText, SanitizedHtml } from '../../lib/htmlSanitizer'

export interface RevealedPayload {
  requestId: string
  contact: string
  medicalNotes: string
}

export interface HelpHistorySectionProps {
  revealed: RevealedPayload | null
  statusMessage: string
}

/**
 * Decomposed Help Feature Module: Decrypted Payload History & Status (#900).
 * Displays locally decrypted payload with XSS sanitization and status alerts.
 */
export function HelpHistorySection({ revealed, statusMessage }: HelpHistorySectionProps) {
  return (
    <>
      {revealed && (
        <div
          data-testid="help-revealed-payload"
          style={{
            marginTop: '0.9rem',
            padding: '0.9rem',
            background: '#1c2c24',
            borderRadius: '0.5rem',
            border: '1px solid rgba(115,87,255,0.5)',
          }}
        >
          <p style={{ fontSize: '0.85rem', margin: 0, color: '#a2a586' }}>
            Decrypted locally with your responder key — this is exactly what an authorized
            responder sees:
          </p>
          {revealed.contact && (
            <p style={{ fontSize: '0.95rem', margin: '0.35rem 0 0' }}>📞 {sanitizeText(revealed.contact)}</p>
          )}
          {revealed.medicalNotes && (
            <div style={{ fontSize: '0.95rem', margin: '0.35rem 0 0', display: 'flex', gap: '6px' }}>
              <span>🩺</span>
              <SanitizedHtml as="span" html={revealed.medicalNotes} />
            </div>
          )}
        </div>
      )}

      {statusMessage && (
        <p
          role="status"
          style={{ marginTop: '1.5rem', padding: '1rem', background: '#1c2c24', borderRadius: '0.5rem' }}
        >
          {statusMessage}
        </p>
      )}
    </>
  )
}

export default HelpHistorySection
