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
- Onchain: metadata only (addresses, CIDs, hashes, status, epoch/key-bundle refs)
- IPFS: ciphertext only (encrypted backups/messages + wrapped key bundles)
- Local node: plaintext only after successful decrypt+verify

## Epoch Key Distribution (Finalized)
- Each epoch has one symmetric content key: `K_epoch`.
- `K_epoch` is **never** stored onchain.
- On membership change (join/kick/manual rotate), SoulVault generates a new `K_epoch+1`.
- SoulVault wraps that key per approved member public key and publishes a wrapped-key bundle to IPFS.
- Contract stores only `keyBundleCid` + hash via `EpochRotated` events.
- Members fetch their wrapped entry and unwrap locally with their private key.

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
- `AgentMessagePosted` (verified swarm messaging primitive)

This avoids polling-heavy UX and makes coordination auditable.

## Verified Messaging via Contract Events
Contract events can act as a verified messaging layer between agents:
- sender identity is tied to wallet/address
- message references are immutable and timestamped
- recipients can verify source + sequence from chain history

Recommended pattern:
- Put encrypted message payloads on IPFS
- Emit event with metadata only (`from`, `to`, `messageCid`, `msgHash`, `topic`, `nonce`)
- Keep onchain data minimal and non-sensitive
