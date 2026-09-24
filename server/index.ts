import express, { Request, Response } from 'express'
import cors from 'cors'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import {
  rpc,
  TransactionBuilder,
  Operation,
  Account,
  Keypair,
  BASE_FEE,
  Networks,
  nativeToScVal,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk'
import { SorobanStateExporter, loadLatestSnapshot } from './indexer/exporter.js'
import { authMiddleware } from './middleware/auth.js'
import { runMigrationsAtStartup } from './db/migrator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : ['https://helphone.com', 'https://staging.helphone.com', 'http://localhost:3000'],
    methods: ['GET', 'POST', 'OPTIONS'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
)
app.use(express.json({ limit: '1mb' }))

const stateExporter = new SorobanStateExporter()

// Health Check Endpoints
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', server: 'helphone-indexer-server', timestamp: new Date().toISOString() })
})

app.get('/zk/health', (_req: Request, res: Response) => {
  res.json({ status: 'ready', ready: true })
})

// Soroban State Export Endpoints
app.post('/api/state/export', async (_req: Request, res: Response) => {
  try {
    const snapshot = await stateExporter.exportState()
    res.json({ success: true, snapshot })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/state/snapshots/latest', (_req: Request, res: Response) => {
  try {
    const snapshot = loadLatestSnapshot()
    if (!snapshot) {
      return res.status(404).json({ success: false, error: 'No snapshots available' })
    }
    res.json({ success: true, snapshot })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// Secure Authenticated Endpoint Example using Cryptographic Auth Middleware
app.post('/api/protected/action', authMiddleware, (req: Request, res: Response) => {
  res.json({ success: true, message: 'Authenticated payload verified successfully', user: (req as any).authenticatedUser })
})

// ── Soroban Footprint Inspection (#517) ──────────────────────────────
// Inspects the storage footprint a contract function invocation touches via an
// RPC simulateTransaction call, so clients can assemble transaction envelopes
// with the required read-only / read-write storage keys already appended
// before the user signs. Results are the authoritative key set the server
// simulator computed — clients cache these templates in memory to optimise
// pre-invocation latency on repetitive status-update transactions.

function argToScVal(arg: unknown): any {
  if (arg === null || arg === undefined) return nativeToScVal(null)
  if (typeof arg === 'object' && (arg as any).type && 'value' in (arg as any)) {
    return nativeToScVal((arg as any).value, { type: (arg as any).type })
  }
  return nativeToScVal(arg)
}

app.post('/api/soroban/footprint/inspect', async (req: Request, res: Response) => {
  try {
    const { contractId, functionName, args = [] } = (req.body || {}) as {
      contractId?: string
      functionName?: string
      args?: unknown[]
    }
    if (typeof contractId !== 'string' || !contractId) {
      return res.status(400).json({ success: false, error: 'contractId is required' })
    }
    if (typeof functionName !== 'string' || !functionName) {
      return res.status(400).json({ success: false, error: 'functionName is required' })
    }

    const rpcUrl = process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org'
    const server = new rpc.Server(rpcUrl, { timeout: 30_000 })
    const source = new Account(Keypair.random().publicKey(), '0')
    const probe = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: process.env.SOROBAN_NETWORK_PASSPHRASE || Networks.TESTNET,
    })
      .addOperation(
        Operation.invokeContractFunction({
          contract: contractId,
          function: functionName,
          args: args.map(argToScVal),
        }),
      )
      .setTimeout(30)
      .build()

    const sim = (await server.simulateTransaction(probe)) as any
    if (sim?.error) {
      return res.status(422).json({ success: false, error: String(sim.error) })
    }

    let builder: SorobanDataBuilder
    if (typeof sim?.transactionData === 'string') {
      builder = new SorobanDataBuilder(sim.transactionData)
    } else if (sim?.transactionData?.build) {
      builder = new SorobanDataBuilder(sim.transactionData.build())
    } else {
      builder = new SorobanDataBuilder()
    }

    const readOnly = builder.getReadOnly()
    const readWrite = builder.getReadWrite()
    res.json({
      success: true,
      template: {
        contractId,
        functionName,
        readOnlyCount: readOnly.length,
        readWriteCount: readWrite.length,
        resourceFee: String(sim?.minResourceFee ?? '0'),
        footprintXdr: builder.build().toXDR('base64'),
      },
    })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || String(err) })
  }
})

// Automated Daily State Snapshot Cron (Interval fallback)
const CRON_INTERVAL_MS = 24 * 60 * 60 * 1000
let exporterInterval: NodeJS.Timeout | null = null

function scheduleStateBackup() {
  console.log('[server] Initializing Soroban Contract State Daily Backup Cron...')
  stateExporter.exportState().catch((err) => console.error('[server] Initial state backup error:', err))

  exporterInterval = setInterval(() => {
    console.log('[server] Executing scheduled daily state snapshot export...')
    stateExporter.exportState().catch((err) => console.error('[server] Scheduled state backup error:', err))
  }, CRON_INTERVAL_MS)
}

if (process.env.NODE_ENV !== 'test') {
  // Apply schema migrations automatically at boot so the database schema
  // stays in sync on every deploy (non-fatal; server serves even on failure).
  void runMigrationsAtStartup()

  app.listen(PORT, () => {
    console.log(`HelPhone Server running on http://localhost:${PORT}`)
    scheduleStateBackup()
  })
}

export { app, stateExporter }
