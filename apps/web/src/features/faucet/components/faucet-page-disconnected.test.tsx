import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { FaucetPage } from "./faucet-page"

// ── Module-level mocks ────────────────────────────────────────────────────────

// useClaim is stubbed because it transitively imports @/lib/contracts.ts, which
// instantiates contract clients at module-load time with test contract IDs that
// fail Stellar strkey validation in bun's test runner.
vi.mock("../hooks/useClaim", () => ({
  useClaim: () => ({
    claimOne: vi.fn(),
    claimAll: vi.fn(),
    pendingTokens: new Set<string>(),
    isBulkPending: false,
  }),
}))

vi.mock("@/ui/Navbar", () => ({ Navbar: () => <nav data-testid="navbar" /> }))

vi.mock("@/shared/components/TokenIcon", () => ({
  TokenIcon: ({ symbol }: { symbol: string }) => <span data-testid={`icon-${symbol}`} />,
}))

vi.mock("@/features/wallet/components/ConnectButton", () => ({
  ConnectButton: () => <button>Connect Wallet</button>,
}))

vi.mock("@/features/wallet/components/NetworkMismatchBanner", () => ({
  NetworkMismatchBanner: () => null,
}))

vi.mock("@/features/wallet/hooks/useNetwork", () => ({
  useNetwork: () => ({ mismatch: false, network: "testnet" }),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FaucetPage — disconnected state (#213)", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })

    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <FaucetPage />
      </QueryClientProvider>,
    )
  }

  it("renders the Testnet Faucet heading", () => {
    renderPage()
    expect(screen.getByRole("heading", { name: "Testnet Faucet" })).toBeInTheDocument()
  })

  it("renders all four token cards", () => {
    renderPage()
    // Each symbol appears twice (card header + contract address list), so use getAllByText
    expect(screen.getAllByText("TUSDC").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("TWBTC").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("TETH").length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText("TXLM").length).toBeGreaterThanOrEqual(1)
  })

  it("renders connect wallet call to action when disconnected", () => {
    renderPage()
    expect(
      screen.getByText("Connect your wallet to claim test tokens."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument()
  })
})
