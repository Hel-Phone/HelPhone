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

// --- Soroban Footprint Inspection (#517) ---
export interface SorobanFootprintKey {
  type: 'readOnly' | 'readWrite'
  /** Base64 xdr.LedgerKey payload (opaque in the API layer). */
  xdr: string
}

export interface SorobanFootprint {
  contractId: string
  functionName: string
  readOnly: SorobanFootprintKey[]
  readWrite: SorobanFootprintKey[]
  resourceFee: string
  footprintXdr: string
  generatedAt: number
}

export interface SorobanFootprintTemplate {
  contractId: string
  functionName: string
  argsKey: string
  readOnlyCount: number
  readWriteCount: number
  resourceFee: string
  footprintXdr: string
}

export interface SorobanFootprintCacheStats {
  size: number
  maxEntries: number
  ttlMs: number
  hits: number
  misses: number
}

export interface SorobanFootprintInspectRequest {
  contractId: string
  functionName: string
  args?: unknown[]
}

export interface SorobanFootprintInspectResponse {
  success: boolean
  template?: SorobanFootprintTemplate
  error?: string
}
