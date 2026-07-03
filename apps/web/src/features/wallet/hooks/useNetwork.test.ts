import { describe, expect, it, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useNetwork, normalizeNetwork } from "./useNetwork"
import { useWalletStore } from "../store/wallet-store"
import { NETWORK } from "@/app/config/network"

describe("normalizeNetwork", () => {
  it("should normalize Stellar Testnet strings", () => {
    expect(normalizeNetwork("testnet")).toBe("testnet")
    expect(normalizeNetwork("TESTNET")).toBe("testnet")
    expect(normalizeNetwork("Test SDF Network ; September 2015")).toBe("testnet")
    expect(normalizeNetwork("  testnet  ")).toBe("testnet")
  })

  it("should normalize Stellar Mainnet/Public strings", () => {
    expect(normalizeNetwork("public")).toBe("mainnet")
    expect(normalizeNetwork("mainnet")).toBe("mainnet")
    expect(normalizeNetwork("PUBLIC")).toBe("mainnet")
    expect(normalizeNetwork("Public Global Stellar Network ; September 2015")).toBe("mainnet")
    expect(normalizeNetwork("  public  ")).toBe("mainnet")
  })

  it("should return unknown for other strings", () => {
    expect(normalizeNetwork("unknown")).toBe("unknown")
    expect(normalizeNetwork("custom")).toBe("unknown")
    expect(normalizeNetwork("arbitrary")).toBe("unknown")
  })

  it("should return unknown for empty or missing inputs", () => {
    expect(normalizeNetwork(null)).toBe("unknown")
    expect(normalizeNetwork(undefined)).toBe("unknown")
    expect(normalizeNetwork("")).toBe("unknown")
    expect(normalizeNetwork("   ")).toBe("unknown")
  })
})

describe("useNetwork Hook", () => {
  beforeEach(() => {
    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  describe("when status is disconnected", () => {
    it("should always return mismatch as false", () => {
      // Set network to a mismatching network but status disconnected
      const testNetwork = NETWORK.name === "mainnet" ? "testnet" : "mainnet"
      useWalletStore.setState({ status: "disconnected", network: testNetwork })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.mismatch).toBe(false)
    })
  })

  describe("when status is connected", () => {
    it("should return mismatch as false if wallet network matches app network", () => {
      useWalletStore.setState({ status: "connected", network: NETWORK.name })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.mismatch).toBe(false)
    })

    it("should return mismatch as true if wallet network does not match app network", () => {
      const opposingNetwork = NETWORK.name === "mainnet" ? "testnet" : "mainnet"
      useWalletStore.setState({ status: "connected", network: opposingNetwork })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.mismatch).toBe(true)
    })

    it("should return mismatch as true for unknown wallet networks", () => {
      useWalletStore.setState({ status: "connected", network: "custom-network" })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.mismatch).toBe(true)
    })
  })

  describe("network classification and labels", () => {
    it("should expose correct details for testnet value", () => {
      useWalletStore.setState({ network: "Test SDF Network ; September 2015" })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.normalizedNetwork).toBe("testnet")
      expect(result.current.isTestnet).toBe(true)
      expect(result.current.isMainnet).toBe(false)
      expect(result.current.displayLabel).toBe("Testnet")
    })

    it("should expose correct details for mainnet/public value", () => {
      useWalletStore.setState({ network: "Public Global Stellar Network ; September 2015" })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.normalizedNetwork).toBe("mainnet")
      expect(result.current.isTestnet).toBe(false)
      expect(result.current.isMainnet).toBe(true)
      expect(result.current.displayLabel).toBe("Mainnet")
    })

    it("should expose correct details for unknown value", () => {
      useWalletStore.setState({ network: "unknown" })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.normalizedNetwork).toBe("unknown")
      expect(result.current.isTestnet).toBe(false)
      expect(result.current.isMainnet).toBe(false)
      expect(result.current.displayLabel).toBe("Unknown")
    })

    it("should expose correct details for missing/null value", () => {
      useWalletStore.setState({ network: null })

      const { result } = renderHook(() => useNetwork())

      expect(result.current.normalizedNetwork).toBe("unknown")
      expect(result.current.isTestnet).toBe(false)
      expect(result.current.isMainnet).toBe(false)
      expect(result.current.displayLabel).toBe("Unknown")
    })
  })
})
