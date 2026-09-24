# Disaster Recovery & Soroban State Backup Runbook

## Overview

HelPhone utilizes an automated Soroban storage state backup system to safeguard contract state data. Contract storage entries (instance, persistent, and temporary) are inspected, parsed, and dumped into versioned JSON snapshot files indexed by Stellar ledger sequence numbers.

---

## Technical Architecture

```
+---------------------------+       +---------------------------+
|  Soroban RPC / Node       | ----> | export-contract-state.sh  |
|  (stellar contract inspect|       |   (CLI & RPC Exporter)    |
+---------------------------+       +---------------------------+
              |                                   |
              v                                   v
+---------------------------+       +---------------------------+
| server/indexer/exporter.ts | ----> |  JSON Snapshot Storage    |
|   (Daily Backup Cron)     |       | ./snapshots/snapshot-*.json|
+---------------------------+       +---------------------------+
```

---

## Storage Snapshot Format

Snapshots are exported in structured JSON format with complete ledger indexing:

```json
{
  "ledgerSequence": 123456,
  "contractId": "CC325F37QW7N2F5M3QGHL4A4O7J2K9L0M1N2O3P4Q5R6S7T8U9V0",
  "timestamp": "2026-09-24T16:00:00.000Z",
  "entries": [
    {
      "key": "CONTRACT_ADMIN",
      "val": { "address": "CC325F37QW7N2F5M3QGHL4A4O7J2K9L0M1N2O3P4Q5R6S7T8U9V0" },
      "durability": "persistent",
      "lastModifiedLedgerSeq": 123450
    }
  ],
  "metadata": {
    "exporterVersion": "1.0.0",
    "totalEntries": 1,
    "networkPassphrase": "Test SDF Network ; September 2015",
    "rpcUrl": "https://soroban-testnet.stellar.org"
  }
}
```

---

## Executing Manual Backups

Run the state exporter shell script:

```bash
# Export using default contract ID and testnet RPC
bash scripts/export-contract-state.sh

# Export with explicit environment variables
CONTRACT_ID="C..." SOROBAN_RPC_URL="https://soroban-testnet.stellar.org" bash scripts/export-contract-state.sh
```

---

## Server Automated Daily Backup Cron

The backend server (`server/index.ts`) initializes an automated daily cron task on startup.
- **Interval**: 24 hours (86,400,000 ms)
- **Output Directory**: `./snapshots/`
- **REST Endpoint**:
  - `POST /api/state/export` - Trigger state dump on demand
  - `GET /api/state/snapshots/latest` - Fetch the latest state snapshot

---

## Disaster Recovery & State Restoration

In case of network partition, state corruption, or redeployment:

1. **Locate Latest Snapshot**:
   ```bash
   ls -la snapshots/snapshot-*.json | sort | tail -n 1
   ```

2. **Verify Snapshot Integrity**:
   Run tests or use `verifySnapshotIntegrity()` helper:
   ```bash
   npm test test/state-export.test.js
   ```

3. **Restore Contract State**:
   Execute Stellar CLI contract restore/invoke commands using snapshot entry payloads:
   ```bash
   stellar contract invoke --id <CONTRACT_ID> --source <ADMIN_KEY> -- restore_state --snapshot-file snapshots/snapshot-123456.json
   ```
