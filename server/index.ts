import express, { Request, Response } from 'express'
import cors from 'cors'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { SorobanStateExporter, loadLatestSnapshot } from './indexer/exporter.js'
import { authMiddleware } from './middleware/auth.js'
import { applyKeepAliveTuning, keepAliveMiddleware } from './middleware/keepAlive.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

// Reuse TCP sockets across sequential requests (see middleware/keepAlive.ts)
app.use(keepAliveMiddleware())

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
  const server = app.listen(PORT, () => {
    console.log(`HelPhone Server running on http://localhost:${PORT}`)
    scheduleStateBackup()
  })
  applyKeepAliveTuning(server)
}

export { app, stateExporter }
