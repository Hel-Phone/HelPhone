import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import {
  HelpMapSection,
  HelpRequestForm,
  HelpRespondersList,
  HelpZkCheckpoint,
  HelpHistorySection,
  HelpShadowHarness,
} from '../src/pages/help/index.ts'

describe('Issue #900: Help Page Decomposed Feature Modules', () => {
  describe('HelpMapSection', () => {
    it('renders location input and search feedback', () => {
      const setSearchQuery = vi.fn()
      const selectSearchSuggestion = vi.fn()
      const handleSearchKeyDown = vi.fn()

      render(
        <HelpMapSection
          location={[37.7749, -122.4194]}
          searchQuery="San Francisco"
          setSearchQuery={setSearchQuery}
          searchSuggestions={[
            { id: '1', text: 'San Francisco', place_name: 'San Francisco, California, United States' },
          ]}
          isOffline={false}
          hasOfflineMatch={false}
          searchError={null}
          handleSearchKeyDown={handleSearchKeyDown}
          selectSearchSuggestion={selectSearchSuggestion}
        />
      )

      expect(screen.getByLabelText(/your location/i)).toBeDefined()
      expect(screen.getByText(/selected location: 37.7749, -122.4194/i)).toBeDefined()
      expect(screen.getByText('San Francisco')).toBeDefined()
    })
  })

  describe('HelpRespondersList', () => {
    it('renders connect wallet button when disconnected, or address when connected', () => {
      const onConnect = vi.fn()
      const { rerender } = render(
        <HelpRespondersList
          walletConnected={false}
          recipientCount={null}
          onConnectWallet={onConnect}
        />
      )

      const btn = screen.getByText(/connect stellar wallet/i)
      fireEvent.click(btn)
      expect(onConnect).toHaveBeenCalledTimes(1)

      rerender(
        <HelpRespondersList
          walletConnected={true}
          walletAddress="GABC123"
          recipientCount={3}
          onConnectWallet={onConnect}
        />
      )
      expect(screen.getByText(/connected wallet: GABC123/i)).toBeDefined()
      expect(screen.getByText(/sealed for 3 keys/i)).toBeDefined()
    })
  })

  describe('HelpZkCheckpoint', () => {
    it('handles passkey authentication trigger and verified state', async () => {
      const onAuth = vi.fn().mockResolvedValue(undefined)
      const { rerender } = render(
        <HelpZkCheckpoint
          passkeyAuthEnabled={true}
          passkeyVerified={false}
          onAuthenticatePasskey={onAuth}
        />
      )

      const authBtn = screen.getByRole('button', { name: /authenticate passkey/i })
      fireEvent.click(authBtn)
      expect(onAuth).toHaveBeenCalledTimes(1)

      rerender(
        <HelpZkCheckpoint
          passkeyAuthEnabled={true}
          passkeyVerified={true}
          onAuthenticatePasskey={onAuth}
        />
      )
      expect(screen.getByText(/passkey verified/i)).toBeDefined()
    })
  })

  describe('HelpRequestForm', () => {
    it('renders encrypted fields and triggers seal and dispatch', () => {
      const onSeal = vi.fn().mockResolvedValue(undefined)
      render(
        <HelpRequestForm
          encryptedDispatchEnabled={true}
          contact="+15550199"
          setContact={vi.fn()}
          medicalNotes="No known allergies"
          setMedicalNotes={vi.fn()}
          plaintextBytes={40}
          overBudget={false}
          revealError=""
          onSealAndDispatch={onSeal}
        />
      )

      expect(screen.getByLabelText(/contact number/i)).toBeDefined()
      expect(screen.getByLabelText(/medical notes/i)).toBeDefined()
      const submitBtn = screen.getByRole('button', { name: /seal & dispatch/i })
      fireEvent.click(submitBtn)
      expect(onSeal).toHaveBeenCalledTimes(1)
    })
  })

  describe('HelpHistorySection', () => {
    it('displays decrypted payload with sanitized text and status message', () => {
      render(
        <HelpHistorySection
          revealed={{
            requestId: 'req-1',
            contact: '+15551234',
            medicalNotes: 'Type 1 Diabetic',
          }}
          statusMessage="Payload sealed successfully"
        />
      )

      expect(screen.getByTestId('help-revealed-payload')).toBeDefined()
      expect(screen.getByText(/Type 1 Diabetic/i)).toBeDefined()
      expect(screen.getByRole('status')).toBeDefined()
      expect(screen.getByText(/Payload sealed successfully/i)).toBeDefined()
    })
  })

  describe('HelpShadowHarness', () => {
    it('renders modern component in standard mode and both in shadow comparison mode', () => {
      const onDrift = vi.fn()
      const { rerender } = render(
        <HelpShadowHarness
          legacyComponent={<div>Legacy Output</div>}
          modernComponent={<div>Modern Output</div>}
          enableShadowComparison={false}
          onDriftDetected={onDrift}
        />
      )

      expect(screen.getByText('Modern Output')).toBeDefined()
      expect(screen.queryByTestId('help-shadow-legacy-container')).toBeNull()

      rerender(
        <HelpShadowHarness
          legacyComponent={<div>Legacy Output</div>}
          modernComponent={<div>Modern Output</div>}
          enableShadowComparison={true}
          onDriftDetected={onDrift}
        />
      )

      expect(screen.getByTestId('help-shadow-legacy-container')).toBeDefined()
    })
  })
})
