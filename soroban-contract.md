// Implementation added

## M-of-N admin governance

`configure_multisig` stores the authorized signer set and threshold. An authorized
signer creates an admin-transfer proposal with `create_admin_proposal`; each signer
may call `approve_admin_proposal` once. `execute_admin_proposal` rejects execution
until approvals meet the threshold and permanently marks executed proposals to
prevent replay. The constructor defaults to a backwards-compatible 1-of-1 set.

## Bounded verification history (ring buffer)

`record_expert_verification` keeps at most **500** entries per wallet. When a wallet's history is full, recording a new entry overwrites the oldest one (FIFO) and emits an `Evicted` event.

| Function | Returns |
| --- | --- |
| `get_expert_verification_count(wallet)` | Verifications ever recorded, evicted ones included. Also the index the next one gets |
| `get_expert_verification_oldest(wallet)` | Index of the oldest entry still readable (`count - 500`, floored at 0) |
| `get_expert_verification_capacity()` | `500` |
| `get_expert_verification(wallet, index)` | The entry, or `None` if evicted or not yet written |

`Evicted` event: topics `["evicted", wallet]`, data `{ index, record }` where `record` is the full displaced `ExpertVerification`, so an indexer can archive it before it is unreadable on chain.

See `docs/storage-optimization.md` for the layout, rent and compatibility notes.
