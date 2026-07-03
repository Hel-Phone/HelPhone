import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AccountBadge } from "./AccountBadge"

// ── Constants ─────────────────────────────────────────────────────────────────
// A valid-looking 56-char Stellar public key used as the test address.
const TEST_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
// formatAddress takes first 6 + "…" + last 4 chars
const SHORTENED = `${TEST_ADDRESS.slice(0, 6)}…${TEST_ADDRESS.slice(-4)}`

// ── Module-level mocks ────────────────────────────────────────────────────────

// Prevent real Horizon XLM balance fetches
vi.mock("../hooks/useBalance", () => ({
  useBalance: () => ({ xlm: 42.5, isLoading: false, error: null }),
}))

// Stub useWallet — no wallet extension needed
vi.mock("../hooks/useWallet", () => ({
  useWallet: () => ({ disconnect: vi.fn() }),
}))

// Stub useNetwork — testnet by default
vi.mock("../hooks/useNetwork", () => ({
  useNetwork: () => ({ isMainnet: false, mismatch: false, network: "testnet" }),
}))

// Stub the explorer URL builder so we can assert it deterministically
vi.mock("@/app/config/network", () => ({
  explorerAccountUrl: (addr: string) =>
    `https://stellar.expert/explorer/testnet/account/${addr}`,
  explorerTxUrl: (hash: string) =>
    `https://stellar.expert/explorer/testnet/tx/${hash}`,
  NETWORK: {
    name: "testnet",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderBadge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <AccountBadge address={TEST_ADDRESS} />
    </QueryClientProvider>,
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("AccountBadge — connected account display (#210)", () => {
  beforeEach(() => {
    // Silence navigator.clipboard errors in happy-dom
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("renders the shortened address text on the trigger button", () => {
    renderBadge()
    expect(screen.getByText(SHORTENED)).toBeInTheDocument()
  })

  it("shows a green connected indicator dot", () => {
    renderBadge()
    // The green dot has aria-hidden; query by its class
    const dot = document.querySelector(".bg-emerald-500")
    expect(dot).not.toBeNull()
  })

  it("opens the dropdown panel when the trigger button is clicked", () => {
    renderBadge()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHORTENED) }))
    // Full address is shown in the expanded panel
    expect(screen.getByText(TEST_ADDRESS)).toBeInTheDocument()
    expect(screen.getByText("Wallet address")).toBeInTheDocument()
  })

  it("renders the explorer link with the correct href when open", () => {
    renderBadge()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHORTENED) }))
    const link = screen.getByRole("link", { name: /View on Explorer/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute(
      "href",
      `https://stellar.expert/explorer/testnet/account/${TEST_ADDRESS}`,
    )
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("renders the XLM balance in the dropdown", () => {
    renderBadge()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHORTENED) }))
    expect(screen.getByText("42.5 XLM")).toBeInTheDocument()
  })

  it("renders network label as Testnet in dropdown", () => {
    renderBadge()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHORTENED) }))
    expect(screen.getByText("Testnet")).toBeInTheDocument()
  })

  it("renders a Disconnect button in the dropdown", () => {
    renderBadge()
    fireEvent.click(screen.getByRole("button", { name: new RegExp(SHORTENED) }))
    expect(screen.getByRole("button", { name: /Disconnect/i })).toBeInTheDocument()
  })
})
