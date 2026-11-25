import React, { useState } from 'react'
import { startAutoSave, clearDraft as clearCrashDraft, restoreDraft } from '../../lib/crashRecovery.ts'
import RadioSheet from '../../components/field/RadioSheet'
import SosSheet from '../../components/field/SosSheet'
import StagingSheet from '../../components/field/StagingSheet'

export interface HelpRequest {
  id?: string
  type?: string
  createdAt?: number
  [key: string]: any
}

export interface RequestFormModuleProps {
  onSubmit: (request: HelpRequest) => Promise<void>
  draftData?: HelpRequest
}

export const RequestFormModule: React.FC<RequestFormModuleProps> = ({ onSubmit, draftData }) => {
  const [formData, setFormData] = useState<HelpRequest>(draftData || restoreDraft() || {})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await startAutoSave(formData)
      await onSubmit(formData)
      clearCrashDraft()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit request')
      await startAutoSave(formData)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <RadioSheet onChange={(v) => setFormData({ ...formData, radio: v })} />
      <SosSheet onChange={(v) => setFormData({ ...formData, sos: v })} />
      <StagingSheet onChange={(v) => setFormData({ ...formData, staging: v })} />
      {error && <div style={{ color: '#FF7A6B' }}>{error}</div>}
      <button type="submit" disabled={loading} style={{ padding: '0.5rem', borderRadius: '4px' }}>
        {loading ? 'Sending...' : 'Send Request'}
      </button>
    </form>
  )
}
