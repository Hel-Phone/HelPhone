/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string
  readonly VITE_STELLAR_NETWORK: 'testnet' | 'mainnet'
  readonly VITE_AEGIS_VAULT_ID?: string
  readonly VITE_EMERGENCY_VAULT_ID?: string
  readonly VITE_HELPHONE_DAO_ID?: string
  readonly VITE_MAINTAINER_VAULT_ID?: string
  /** @deprecated Use VITE_HELPHONE_DAO_ID. */
  readonly VITE_HELPHONE_CONTRACT_ID: string
  readonly VITE_FRIENDBOT_URL: string
  readonly VITE_ZK_PROVER_URL: string
  readonly VITE_ZK_BROWSER_FALLBACK: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
