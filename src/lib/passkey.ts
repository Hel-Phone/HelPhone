import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { PasskeyCredential, WebAuthnVerificationResult } from '../types/index.js'

type ServerResponse = { options: Record<string, unknown>; error?: string }

async function request(path: string, body: unknown) {
  const response = await fetch(`/api/auth/passkey/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Passkey request failed (${response.status})`)
  return result
}

export class PasskeyManager {
  public isWebAuthnSupported(): boolean {
    return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && typeof navigator.credentials !== 'undefined'
  }

  public async registerPasskey(username: string, displayName: string): Promise<PasskeyCredential | null> {
    if (!this.isWebAuthnSupported()) throw new Error('WebAuthn Passkeys are not supported in this browser')
    const { options } = await request('register/options', { username, displayName }) as ServerResponse
    const response = await startRegistration({ optionsJSON: options as never })
    const result = await request('register/verify', { challenge: options.challenge, response })
    if (result.sessionToken) sessionStorage.setItem('helphone-passkey-session', result.sessionToken)
    return { id: response.id, rawId: response.rawId, type: 'public-key', response: response.response, challenge: String(options.challenge) } as unknown as PasskeyCredential
  }

  public async authenticatePasskey(_clientChallenge?: string, username?: string): Promise<PasskeyCredential | null> {
    if (!this.isWebAuthnSupported()) throw new Error('WebAuthn Passkeys are not supported in this browser')
    const { options } = await request('login/options', { username }) as ServerResponse
    const response = await startAuthentication({ optionsJSON: options as never })
    return { id: response.id, rawId: response.rawId, type: 'public-key', response: response.response, challenge: String(options.challenge) } as unknown as PasskeyCredential
  }

  public async verifyAssertion(credential: PasskeyCredential): Promise<WebAuthnVerificationResult> {
    const result = await request('login/verify', { challenge: credential.challenge, response: credential })
    if (result.sessionToken) sessionStorage.setItem('helphone-passkey-session', result.sessionToken)
    return { verified: result.verified === true, userHandle: result.userHandle }
  }
}

export const passkeyManager = new PasskeyManager()
