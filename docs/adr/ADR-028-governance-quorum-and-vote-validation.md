# ADR-028: Snapshot-Based Governance Quorum and Vote Validation

## Status

Accepted

## Context

The DAO previously recorded a proposal's total supply but read each voter's
current balance when the vote was cast. A transfer between proposal creation
and voting could therefore change voting power and make the quorum result
unreproducible. The execution path also needed an explicit, inspectable quorum
rule and a safe way to correct a vote without counting the same weight twice.

## Decision

- A proposal snapshots the governance-token ledger and total supply at
  creation. The token contract must expose `balance_at(holder, ledger)` using
  its balance checkpoints.
- A vote uses only the holder's balance at that snapshot ledger. Zero balances
  cannot vote, and a single holder can have only one recorded weight.
- Quorum is 20% of the snapshot total supply, counting For, Against, and
  Abstain participation. A proposal must meet quorum and receive strictly more
  than 50% of decisive votes to pass.
- `rotate_vote` changes the direction of an existing vote while preserving its
  snapshot weight. It removes the old tally before adding the new one, so vote
  rotation cannot inflate participation.
- A passed proposal must still be queued and wait the 48-hour timelock before
  execution. Execution is rejected unless the proposal has passed and the
  timelock has elapsed.

## Consequences

Governance-token implementations need historical balance checkpoints and must
keep them available for at least the voting and execution lifecycle of a
proposal. The DAO now exposes the snapshot denominator and quorum requirement
for wallets and indexers, making failed quorum decisions auditable.
