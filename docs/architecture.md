# Architecture (Clear Version)

## Components
1. **SoulVault CLI (owner + agents)**
   - Watches contract events
   - Handles join requests/approvals
   - Manages encrypted backup/restore
   - Triggers and validates epoch rekey (owner)
   - Issues Historical Key Grants for new/recovered joiners (owner)
   - Manages IPFS pinning (`soulvault ipfs pin-all`)
   - Supports multiple swarms

2. **Swarm Contract (one per swarm)**
   - Membership registry (stores member pubkeys directly in contract state)
   - Join request lifecycle
   - `membershipVersion` counter for rekey concurrency control
   - Backup pointer updates (CID refs)
   - Historical key grant references
   - Optional quorum policy for approvals (post-MVP)

3. **Encrypted Storage (IPFS)**
   - Encrypted backup bundles (shared + per-agent)
   - Encrypted manifests
   - Wrapped epoch key bundles (one per epoch, includes owner escrow entry)
   - Historical key bundles (per granted member)
   - **For MVP, all content is pinned by the owner** via a local IPFS node or managed pinning service (Pinata/Web3Storage). Post-MVP, a managed relay/pinning SaaS layer can take over this responsibility.

4. **OpenClaw Node**
   - Generates agent keypair on the node
   - Submits join request (pubkey in calldata — no secure channel needed)
   - Restores approved encrypted state
   - Runs agent workloads after restore

5. **(Optional) Network Overlay Module**
   - WireGuard + relay/control-plane integration
   - Uses swarm membership/epoch events as authorization signals
   - Out of MVP scope, planned as post-MVP layer

---

## Data Boundaries
- **Onchain**: metadata only (addresses, pubkeys, CIDs, hashes, status, epoch refs, membershipVersion)
- **IPFS**: ciphertext only (encrypted backups/messages + wrapped key bundles + historical key bundles)
- **Local node**: plaintext only after successful decrypt + verify

---

## State Partitioning
Keep a single swarm epoch key (`K_epoch`) for all members and all bundle types. State is stored in two logical buckets:
- **Shared swarm state** (common coordination/config artifacts)
- **Per-agent state** (agent-specific soul/memory bundles)

### Privacy model (explicit design decision)
All per-agent bundles are encrypted under the shared `K_epoch`. This means **any approved swarm member can decrypt any other member's state**. This is intentional — it enables the coordination layer where agents can read each other's memory and configuration when needed for collaborative tasks.

Post-MVP option: introduce per-agent derived keys (`K_agent = HKDF(K_epoch, "agent", agentAddress)`) to allow private agent state alongside shared swarm state. For MVP, the shared model is simpler and more useful for coordination.

### On-chain backup pointer shape (coordination vs off-chain split)
Off-chain artifacts remain **shared bundle(s)** plus **per-agent bundle(s)**, all ciphertext under the same **`K_epoch`**. On-chain, you can either store **one** swarm-level `latestBackupPointer` (a single “`HEAD`” that updates in place) or **`memberBackupPointers[address]`** so each agent has its own latest tip (“one branch per member”) without overwriting peers. See `docs/protocol-v0.1.md` §3 and §8. Per-member pointers do **not** change the privacy model: ciphertext visibility is still governed by **`K_epoch`** and membership, not by who can read the contract row.

---

## Epoch Key Distribution
- Each epoch has one symmetric content key: `K_epoch`.
- `K_epoch` is **never** stored onchain.
- On membership change (join/kick/manual rotate), owner CLI generates a new `K_epoch+1`.
- Owner wraps that key for each approved member's pubkey (fetched from contract state, not IPFS) + an owner escrow entry.
- Owner publishes wrapped-key bundle to IPFS.
- Contract stores only `keyBundleCid` + hash + `membershipVersion` via `EpochRotated` event.
- Members fetch their wrapped entry and unwrap locally with their private key.

### Rekey concurrency control
`rotateEpoch` requires `expectedMembershipVersion`. If membership changed between when the owner prepared the bundle and when the tx is mined, the transaction reverts. Owner retries with updated membership snapshot. This is the correct EVM pattern — mempool transactions do not hold locks.

---

## Historical Key Access
New joiners and recovered nodes obtain access to historical epochs via a **Historical Key Grant** issued by the owner:
- Owner re-wraps historical `K_epoch` values (recovered via owner escrow entries in past bundles) for the new member's pubkey.
- Resulting Historical Key Bundle is uploaded to IPFS and referenced by `HistoricalKeyBundleGranted` event.
- New member can then decrypt any past backup or message from any granted epoch.

---

## Multi-Swarm Model
Every swarm is identified by a contract address + chainId. SoulVault keeps local profiles:
- `swarmName`
- `chainId`
- `contractAddress`
- `ownerAddress`
- `active` flag

SoulVault commands execute against the active swarm unless `--swarm` is provided.

---

## Event-Driven Control Loop
SoulVault listens for:
- `JoinRequested` — owner: review and approve
- `JoinApproved` — owner: trigger rekey prompt; new member: trigger restore
- `MemberRemoved` — owner: trigger rekey prompt
- `EpochRotated` — all members: fetch and unwrap new wrapped key
- `BackupPointerUpdated` — all members: awareness of latest backup CID
- `HistoricalKeyBundleGranted` — target member: fetch and unwrap historical keys
- `AgentMessagePosted` — members: fetch and decrypt message payload from IPFS
- `AgentManifestUpdated` — informational: agent environment metadata updated
- `RekeyRequested` — post-MVP Chainlink signal: owner acts on rekey prompt

This avoids polling-heavy UX and makes all coordination auditable onchain.

---

## Verified Messaging via Contract Events
Contract events serve as a verified messaging layer between agents:
- Sender identity is tied to wallet address (must be an approved member).
- Message references (CID/hash/topic/seq/epoch) are immutable and timestamped onchain.
- Recipients can verify source, sequence, and epoch from chain history.
- `epoch` must equal `currentEpoch` at time of posting — no cross-epoch message ambiguity.

Payloads are encrypted with current `K_epoch` and stored on IPFS. All swarm members can decrypt any message payload. Only metadata is emitted onchain.

---

## IPFS Pinning Responsibility
**MVP:** Owner is responsible for pinning all CIDs referenced by swarm contract events. The CLI provides `soulvault ipfs pin-all` to scan all historical contract events and pin each referenced CID via the configured provider.

**Post-MVP / SaaS:** A managed SoulVault relay/pinning service handles availability with multiple pinners for redundancy. Service fees payable via swarm treasury (USDC). Self-hosted mode always remains available.

---

## WireGuard / Relay Integration (Post-MVP)
- Contract/events are the authorization plane, not the transport plane.
- Do not use `K_epoch` directly as a tunnel transport key.
- On join/epoch changes, SoulVault triggers network credential refresh (SSH certs/WireGuard peers).
- Optional relay/control-plane facilitates NAT traversal for outbound-only peers.
- This layer is intentionally excluded from MVP to keep scope tight.
