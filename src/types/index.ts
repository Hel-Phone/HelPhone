/**
 * HelPhone System-Wide TypeScript Definitions
 */

// --- Feature Flags Subsystem ---
export interface FeatureFlagRuleset {
  enabled: boolean
  rolloutPercentage?: number
  targets?: {
    roles?: string[]
    environments?: string[]
    userIds?: string[]
  }
  environmentOverrides?: Record<string, boolean>
}

export interface FeatureFlagConfig {
  version: string
  updatedAt?: string
  flags: Record<string, FeatureFlagRuleset>
}

export interface UserContext {
  id?: string
  role?: string
  environment?: string
  deviceId?: string
}

export interface FlagEvaluationResult {
  flagKey: string
  enabled: boolean
  reason: 'default' | 'env_override' | 'target_match' | 'percentage_rollout' | 'disabled'
}

// --- Soroban State & Exporter Subsystem ---
export interface SorobanStorageEntry {
  key: string
  val: any
  durability: 'instance' | 'persistent' | 'temporary'
  lastModifiedLedgerSeq?: number
}

export interface ContractStateSnapshot {
  ledgerSequence: number
  contractId: string
  timestamp: string
  entries: SorobanStorageEntry[]
  metadata: {
    exporterVersion: string
    totalEntries: number
    networkPassphrase: string
    rpcUrl: string
  }
}

// --- Cryptography & WebAuthn / Passkey Subsystem ---
export interface PasskeyCredential {
  id: string
  rawId: string
  type: 'public-key'
  response: {
    clientDataJSON: string
    authenticatorData: string
    signature: string
    userHandle?: string
  }
}

export interface WebAuthnVerificationResult {
  verified: boolean
  publicKeyHex?: string
  counter?: number
  userHandle?: string
  error?: string
}

export interface CryptoKeyPair {
  publicKey: string
  secretKey: string
}

export interface SignaturePayload {
  message: string
  signature: string
  publicKey: string
  algorithm: 'ed25519' | 'webauthn-p256' | 'aes-gcm'
  timestamp: number
  nonce?: string
}

export interface EncryptedData {
  ciphertext: string
  iv: string
  authTag: string
  algorithm: 'AES-GCM'
}

// --- Wallet & State Context ---
export interface WalletState {
  address: string | null
  network: string
  isConnected: boolean
  walletType: string | null
  passkeyEnabled: boolean
}

// --- Client Storage Encryption ---
export interface KeyDerivationBenchmark {
  iterations: number
  runs: number
  medianMs: number
  maxMs: number
  budgetMs: number
  withinBudget: boolean
}

// --- Map Overlay Rendering ---
export type OverlayKind = 'pending' | 'enroute' | 'resolved' | 'responder'

/** A marker drawn on the community map's canvas overlay, in map (viewBox) units. */
export interface MapOverlay {
  id: string
  x: number
  y: number
  kind: OverlayKind
}

export interface OverlayRenderStats {
  fps: number
  frames: number
  windowMs: number
}
