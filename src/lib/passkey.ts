import type { PasskeyCredential, WebAuthnVerificationResult } from '../types/index.js'
import { verifyWebAuthnSignature } from './crypto.js'

export class PasskeyManager {
  private rpName: string
  private rpId: string

  constructor(rpName = 'HelPhone Emergency Network', rpId = 'helphone.com') {
    this.rpName = rpName
    this.rpId = rpId
  }

  public isWebAuthnSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof navigator.credentials !== 'undefined'
    )
  }

  public generateChallenge(): string {
    const randomBytes = new Uint8Array(32)
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(randomBytes)
    } else {
      for (let i = 0; i < 32; i++) randomBytes[i] = Math.floor(Math.random() * 256)
    }
    return Buffer.from(randomBytes).toString('base64url')
  }

  public async registerPasskey(userName: string, userDisplayName: string): Promise<PasskeyCredential | null> {
    if (!this.isWebAuthnSupported()) {
      throw new Error('WebAuthn Passkeys are not supported in this browser environment')
    }

    const challenge = this.generateChallenge()
    const userIdBytes = new TextEncoder().encode(userName)

    const publicKeyOptions: PublicKeyCredentialCreationOptions = {
      challenge: Buffer.from(challenge, 'base64url'),
      rp: { name: this.rpName, id: window.location.hostname || this.rpId },
      user: {
        id: userIdBytes,
        name: userName,
        displayName: userDisplayName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' }, // ES256 (P-256)
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
      },
      timeout: 60000,
    }

    const credential = (await navigator.credentials.create({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential

    if (!credential) return null

    const response = credential.response as AuthenticatorAttestationResponse

    const authData = (response as any).getAuthenticatorData
      ? (response as any).getAuthenticatorData()
      : new Uint8Array()

    return {
      id: credential.id,
      rawId: Buffer.from(credential.rawId).toString('hex'),
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(response.clientDataJSON).toString('utf-8'),
        authenticatorData: Buffer.from(authData as any).toString('hex'),
        signature: 'ATTESTATION_OK',
      },
    }
  }

  public async authenticatePasskey(challenge: string): Promise<PasskeyCredential | null> {
    if (!this.isWebAuthnSupported()) {
      throw new Error('WebAuthn Passkeys are not supported in this environment')
    }

    const publicKeyOptions: PublicKeyCredentialRequestOptions = {
      challenge: Buffer.from(challenge, 'base64url'),
      rpId: window.location.hostname || this.rpId,
      userVerification: 'preferred',
      timeout: 60000,
    }

    const assertion = (await navigator.credentials.get({
      publicKey: publicKeyOptions,
    })) as PublicKeyCredential

    if (!assertion) return null

    const response = assertion.response as AuthenticatorAssertionResponse

    return {
      id: assertion.id,
      rawId: Buffer.from(assertion.rawId).toString('hex'),
      type: 'public-key',
      response: {
        clientDataJSON: Buffer.from(response.clientDataJSON).toString('utf-8'),
        authenticatorData: Buffer.from(response.authenticatorData).toString('hex'),
        signature: Buffer.from(response.signature).toString('hex'),
        userHandle: response.userHandle ? Buffer.from(response.userHandle).toString('hex') : undefined,
      },
    }
  }

  public async verifyAssertion(
    credential: PasskeyCredential,
    expectedChallenge: string
  ): Promise<WebAuthnVerificationResult> {
    return verifyWebAuthnSignature(
      credential.response.clientDataJSON,
      credential.response.authenticatorData,
      credential.response.signature,
      expectedChallenge
    )
  }
}

export const passkeyManager = new PasskeyManager()
