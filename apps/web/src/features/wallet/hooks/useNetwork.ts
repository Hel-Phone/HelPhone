import { useWalletStore } from "../store/wallet-store"
import { NETWORK } from "@/app/config/network"

export function normalizeNetwork(network: string | null | undefined): "testnet" | "mainnet" | "unknown" {
  if (!network) return "unknown"

  const normalized = network.trim().toLowerCase()

  if (
    normalized === "testnet" ||
    normalized === "test sdf network ; september 2015"
  ) {
    return "testnet"
  }

  if (
    normalized === "public" ||
    normalized === "mainnet" ||
    normalized === "public global stellar network ; september 2015"
  ) {
    return "mainnet"
  }

  return "unknown"
}

export function useNetwork() {
  const { network, status } = useWalletStore()

  const normalizedNetwork = normalizeNetwork(network)
  const isTestnet = normalizedNetwork === "testnet"
  const isMainnet = normalizedNetwork === "mainnet"
  
  // Mismatch only meaningful when a wallet is connected
  const mismatch = status === "connected" && normalizedNetwork !== NETWORK.name

  const displayLabel =
    normalizedNetwork === "testnet"
      ? "Testnet"
      : normalizedNetwork === "mainnet"
      ? "Mainnet"
      : "Unknown"

  return {
    network,
    normalizedNetwork,
    isTestnet,
    isMainnet,
    mismatch,
    displayLabel,
  }
}
