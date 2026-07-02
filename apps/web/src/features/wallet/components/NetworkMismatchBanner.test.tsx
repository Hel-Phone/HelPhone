import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { useWalletStore } from "../store/wallet-store"
import { NetworkMismatchBanner } from "./NetworkMismatchBanner"
import { NETWORK } from "@/app/config/network"

// ── Mock router ──────────────────────────────────────────────────────────────
const mockLocation = { pathname: "/faucet" }

vi.mock("@tanstack/react-router", () => ({
  useLocation: () => mockLocation,
}))

describe("NetworkMismatchBanner (#211)", () => {
  let originalNetworkName: "testnet" | "mainnet"

  beforeAll(() => {
    originalNetworkName = NETWORK.name
  })

  beforeEach(() => {
    // Clear sessionStorage and reset mock defaults
    sessionStorage.clear()
    mockLocation.pathname = "/faucet"
    NETWORK.name = "testnet"

    // Default wallet state: connected to testnet
    useWalletStore.setState({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletId: "freighter",
      status: "connected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    NETWORK.name = originalNetworkName
  })

  it("does not render when networks match (both testnet)", () => {
    render(<NetworkMismatchBanner />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not render when wallet is disconnected", () => {
    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      network: "testnet",
    })
    render(<NetworkMismatchBanner />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not render on landing page (pathname = '/') even with mismatch", () => {
    mockLocation.pathname = "/"
    NETWORK.name = "mainnet" // Mismatch: app mainnet vs wallet testnet
    render(<NetworkMismatchBanner />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("renders warning banner when app is testnet and wallet is mainnet", () => {
    // Wallet mainnet, App testnet
    useWalletStore.setState({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      walletId: "freighter",
      status: "connected",
      network: "mainnet",
    })

    render(<NetworkMismatchBanner />)

    const alert = screen.getByRole("alert")
    expect(alert).toBeInTheDocument()
    expect(
      screen.getByText(
        /Your wallet is connected to Mainnet but this app is running on Testnet\. Please switch networks in your wallet\./i,
      ),
    ).toBeInTheDocument()
  })

  it("renders warning banner when app is mainnet and wallet is testnet", () => {
    // Wallet testnet, App mainnet
    NETWORK.name = "mainnet"

    render(<NetworkMismatchBanner />)

    const alert = screen.getByRole("alert")
    expect(alert).toBeInTheDocument()
    expect(
      screen.getByText(
        /Your wallet is connected to Testnet but this app is running on Mainnet\. Please switch networks in your wallet\./i,
      ),
    ).toBeInTheDocument()
  })

  it("dismisses the banner when the Dismiss button is clicked", () => {
    NETWORK.name = "mainnet" // Wallet testnet vs App mainnet

    const { rerender } = render(<NetworkMismatchBanner />)

    expect(screen.getByRole("alert")).toBeInTheDocument()

    const dismissButton = screen.getByRole("button", { name: /Dismiss/i })
    fireEvent.click(dismissButton)

    // Alert should immediately disappear from DOM
    rerender(<NetworkMismatchBanner />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()

    // Assert that sessionStorage was updated
    expect(sessionStorage.getItem("so4-network-mismatch-dismissed")).toBe("1")
  })

  it("respects pre-existing dismissal state from sessionStorage", () => {
    NETWORK.name = "mainnet" // Wallet testnet vs App mainnet
    sessionStorage.setItem("so4-network-mismatch-dismissed", "1")

    render(<NetworkMismatchBanner />)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
