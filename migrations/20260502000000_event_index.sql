-- Index contract_events access paths (issue #519) so the Soroban indexer's
-- watcher/archival and state-replay stay fast as the table grows.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block, so
-- the migrator detects the CONCURRENTLY token and applies this file outside
-- a transaction (single session, one statement at a time). See
-- server/db/migrator.ts.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_events_topic_time
    ON contract_events (topic, emitted_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_events_tenant_time
    ON contract_events (tenant_id, emitted_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contract_events_ledger
    ON contract_events (ledger);