import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { error } from 'node:console'
import { setTimeout } from 'node:timers'
import manifest from '../contracts/manifest.json' with { type: 'json' }

const children = []
let shuttingDown = false
const network = process.env.VITE_STELLAR_NETWORK || process.env.STELLAR_NETWORK || 'testnet'
const contractEnvNames = {
  aegis_vault: 'VITE_AEGIS_VAULT_ID',
  emergency_vault: 'VITE_EMERGENCY_VAULT_ID',
  helphone_dao: 'VITE_HELPHONE_DAO_ID',
  maintainer_vault: 'VITE_MAINTAINER_VAULT_ID',
}

if (network !== 'testnet' && network !== 'mainnet') {
  throw new Error(`Unsupported VITE_STELLAR_NETWORK: ${network}`)
}

for (const [contract, variableName] of Object.entries(contractEnvNames)) {
  if (!process.env[variableName] && manifest[contract][network].id !== 'UNDEPLOYED') {
    process.env[variableName] = manifest[contract][network].id
  }
}
process.env.VITE_STELLAR_NETWORK ||= network

function prefixPipe(stream, label, sink) {
  const rl = createInterface({ input: stream })
  rl.on('line', line => {
    if (!line.trim()) return
    sink.write(`[${label}] ${line}\n`)
  })
}

function run(label, command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  })

  children.push(child)
  prefixPipe(child.stdout, label, process.stdout)
  prefixPipe(child.stderr, label, process.stderr)

  child.on('exit', code => {
    if (shuttingDown) return
    if (code && code !== 0) {
      error(`[${label}] exited with code ${code}`)
      shutdown(code)
    }
  })

  return child
}

function shutdown(code = 0) {
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(code), 250)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('prover', 'node', ['server/index.js'], {
  PORT: process.env.ZK_PROVER_PORT || '3001',
})
run('vite', 'vite', ['--host', '127.0.0.1'], {
  VITE_ZK_PROVER_URL: process.env.VITE_ZK_PROVER_URL || '/zk',
  VITE_ZK_BROWSER_FALLBACK: process.env.VITE_ZK_BROWSER_FALLBACK || 'false',
})
