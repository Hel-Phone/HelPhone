// Implementation added

## M-of-N admin governance

`configure_multisig` stores the authorized signer set and threshold. An authorized
signer creates an admin-transfer proposal with `create_admin_proposal`; each signer
may call `approve_admin_proposal` once. `execute_admin_proposal` rejects execution
until approvals meet the threshold and permanently marks executed proposals to
prevent replay. The constructor defaults to a backwards-compatible 1-of-1 set.
