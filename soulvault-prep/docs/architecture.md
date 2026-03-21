# Architecture (Clear Version)

## Components
1. **SoulVault CLI (owner + agents)**
   - Watches contract events
   - Handles join requests/approvals
   - Manages encrypted backup/restore
   - Supports multiple swarms

2. **Swarm Contract (one per swarm)**
   - Membership registry
   - Join request lifecycle
   - Backup pointer updates (CID refs)
   - Optional quorum policy for approvals

3. **Encrypted Storage (IPFS)**
   - Encrypted bundle blob
   - Encrypted manifest
   - Optional encrypted bootstrap artifact refs

4. **OpenClaw Node**
   - Generates agent keypair
   - Requests join
   - Restores approved encrypted state

## Data Boundaries
- Onchain: metadata only (addresses, CIDs, hashes, status)
- IPFS: ciphertext only
- Local node: plaintext only after successful decrypt+verify

## Multi-Swarm Model
- Every swarm is identified by a contract address + chainId.
- SoulVault keeps local profiles:
  - `swarmName`
  - `chainId`
  - `contractAddress`
  - `ownerAddress`
  - `active` flag

### Switch Context
`SoulVault` commands execute against active swarm unless `--swarm` provided.

## Event-Driven Control Loop
SoulVault listens for:
- `JoinRequested`
- `JoinApproved`
- `BackupPointerUpdated`

This avoids polling-heavy UX and makes coordination auditable.
