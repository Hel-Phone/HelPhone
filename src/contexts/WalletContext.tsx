import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { StellarWalletsKit } from '@creit-tech/stellar-wallets-kit/sdk'
import { KitEventType } from '@creit-tech/stellar-wallets-kit/types'
import type { WalletState } from '../types/index.js'
import { generateEd25519Keypair, encryptAESGCM, decryptAESGCM } from '../lib/crypto.js'
import { clientEnv } from '../lib/env'
import { getContractDeployment, type StellarNetwork } from '../../shared/contractManifest'

interface WalletContextValue {
  walletState: WalletState
  connectWallet: (walletType?: string) => Promise<void>
  disconnectWallet: () => void
  generateEncryptedSessionKey: (passcode: string) => Promise<string>
  decryptSessionKey: (encryptedHex: string, passcode: string) => Promise<string>
}

const WalletContext = createContext<WalletContextValue | undefined>(undefined)

function normalizeNetwork(value: string): StellarNetwork | null {
  const network = value.toLowerCase()
  if (network.includes('test')) return 'testnet'
  if (network.includes('public') || network.includes('main')) return 'mainnet'
  return null
}

export function isWalletNetworkMismatch(
  walletNetwork: string,
  targetNetwork: StellarNetwork,
): boolean {
  const walletNetworkName = normalizeNetwork(walletNetwork)
  const deployment = getContractDeployment('helphone_dao', targetNetwork)
  return (
    walletNetworkName !== targetNetwork ||
    deployment.id === 'UNDEPLOYED' ||
    deployment.id !== clientEnv.VITE_HELPHONE_DAO_ID
  )
}

function WrongNetworkScreen({ targetNetwork }: { targetNetwork: StellarNetwork }) {
  return (
    <main
      role="alert"
      aria-live="assertive"
      style={{
        alignItems: 'center',
        background: '#1c2c24',
        color: '#ECE0CC',
        display: 'flex',
        fontFamily: 'system-ui, sans-serif',
        inset: 0,
        justifyContent: 'center',
        padding: 24,
        position: 'fixed',
        textAlign: 'center',
        zIndex: 10000,
      }}
    >
      <section>
        <h1>Wrong network</h1>
        <p>
          This build targets Stellar {targetNetwork}. Switch your wallet to that
          network before sending or claiming.
        </p>
      </section>
    </main>
  )
}

export const WalletProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    network: clientEnv.VITE_STELLAR_NETWORK,
    isConnected: false,
    walletType: null,
    passkeyEnabled: true,
  })

  useEffect(() => {
    const unsubscribe = StellarWalletsKit.on(KitEventType.STATE_UPDATED, (event) => {
      if (event.payload.networkPassphrase) {
        setWalletState((prev) => ({
          ...prev,
          network: event.payload.networkPassphrase,
        }))
      }
    })
    return unsubscribe
  }, [])

  const connectWallet = async (walletType = 'freighter') => {
    // Simulated connection / SWK kit integration
    const mockAddress = 'GBRPYHIL2CI3FNQ4BXLFMNDLFPPPU2HY5BKGOWTGWCTWMCWHAZ5W6FED'
    setWalletState((prev) => ({
      ...prev,
      address: mockAddress,
      isConnected: true,
      walletType,
    }))
  }

  const disconnectWallet = () => {
    setWalletState((prev) => ({
      ...prev,
      address: null,
      isConnected: false,
      walletType: null,
    }))
  }

  const generateEncryptedSessionKey = async (passcode: string): Promise<string> => {
    const keypair = generateEd25519Keypair()
    const encrypted = await encryptAESGCM(keypair.secretKey, passcode)
    return JSON.stringify(encrypted)
  }

  const decryptSessionKey = async (encryptedJson: string, passcode: string): Promise<string> => {
    const encrypted = JSON.parse(encryptedJson)
    return decryptAESGCM(encrypted, passcode)
  }

  const targetNetwork = clientEnv.VITE_STELLAR_NETWORK
  if (
    walletState.isConnected &&
    isWalletNetworkMismatch(walletState.network, targetNetwork)
  ) {
    return <WrongNetworkScreen targetNetwork={targetNetwork} />
  }

  return (
    <WalletContext.Provider
      value={{
        walletState,
        connectWallet,
        disconnectWallet,
        generateEncryptedSessionKey,
        decryptSessionKey,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return context
}
