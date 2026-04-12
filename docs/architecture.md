# Architecture (Clear Version)

## Components
1. **SoulVault CLI (owner + agents)**
   - Uses an entity-first model built around organizations, swarms, and agents
   - Watches contract events
   - Handles join requests/approvals
   - Manages encrypted backup/restore
   - Triggers and validates epoch rekey (owner)
   - Issues Historical Key Grants for new/recovered joiners (owner)
   - Creates/updates per-agent ERC-8004 identities (Model 1)
   - Manages organization ENS roots and swarm/agent public naming metadata
   - Supports owner funding flows for agent wallets
   - Injects optional harness metadata during ERC-8004 registration
   - Responds to swarm backup-trigger events by running local harness backup commands
   - Falls back to heartbeat/system cron scheduling when no event trigger is used
   - Uploads encrypted backup artifacts to 0G Storage
   - Publishes per-swarm backup file mappings onchain for every swarm the agent belongs to
   - Supports multiple organizations and multiple swarms

2. **Swarm Contract (one per swarm)**
   - Membership registry (stores member pubkeys directly in contract state)
   - Join request lifecycle
   - `membershipVersion` counter for rekey concurrency control
   - Backup file mapping updates (per-member merkle root + storage locator + tx hash refs)
   - Historical key grant references
   - Optional quorum policy for approvals (post-MVP)

3. **Encrypted Storage (0G Storage)**
   - Encrypted backup bundles (shared + per-agent)
   - Encrypted manifests
   - Wrapped epoch key bundles (one per epoch, includes owner escrow entry)
   - Historical key bundles (per granted member)
   - **For MVP, 0G Storage is the system of record for encrypted memories/backups**. SoulVault uploads XChaCha20-encrypted tar bundles and records verifiable references back into each swarm contract.

4. **OpenClaw Node**
   - Generates agent keypair on the node
   - Submits join request (pubkey in calldata — no secure channel needed)
   - Restores approved encrypted state
   - Runs agent workloads after restore

5. **ERC-8004 Identity Layer (per-agent, Model 1)**
   - Each SoulVault agent MAY register a public ERC-8004 identity
   - `agentURI` is stored as a base64-encoded data URI for the public registration file
   - Registration includes optional harness metadata (for example `openclaw`, `hermes`)
   - Optional onchain metadata keys can point to the latest public-safe manifest/profile references
   - Identity/reputation/validation are public trust surfaces; they do not replace SoulVault membership, rekey, or backup protocols

6. **(Optional) Network Overlay Module**
   - WireGuard + relay/control-plane integration
   - Uses swarm membership/epoch events as authorization signals
   - Out of MVP scope, planned as post-MVP layer

---

## Data Boundaries
- **Onchain (SoulVault)**: metadata only (addresses, pubkeys, CIDs, hashes, status, epoch refs, membershipVersion)
- **Onchain / Offchain (ERC-8004)**: public identity metadata only (agent registry id, base64 `agentURI`, public service endpoints, public-safe manifest/profile pointers, optional reputation/validation references)
- **0G encrypted storage**: ciphertext only (encrypted backups/messages + wrapped key bundles + historical key bundles)
- **Local node**: plaintext only after successful decrypt + verify

---

## State Partitioning
Keep a single swarm epoch key (`K_epoch`) for all members and all bundle types. State is stored in two logical buckets:
- **Shared swarm state** (common coordination/config artifacts)
- **Per-agent state** (agent-specific soul/memory bundles)

### Privacy model (explicit design decision)
All per-agent bundles are encrypted under the shared `K_epoch`. This means **any approved swarm member can decrypt any other member's state**. This is intentional — it enables the coordination layer where agents can read each other's memory and configuration when needed for collaborative tasks.

Post-MVP / proposal: optional **per-agent private memory** under **`K_agent`** (random key + optional recovery wrap to cold/guardian keys), contrasted with shared **`K_epoch`** — trust models and use cases: **`docs/K_agent_protocol_proposal_v0.md`**. A derived key such as `HKDF(K_epoch, "agent", agentAddress)` would **not** give privacy from swarm members who hold `K_epoch`; use **`K_agent` independent of `K_epoch`** for peer-opaque memories. For MVP, the shared `K_epoch` model is simpler and more useful for coordination.

---

## Epoch Key Distribution
- Each epoch has one symmetric content key: `K_epoch`.
- `K_epoch` is **never** stored onchain.
- On membership change (join/kick/manual rotate), owner CLI generates a new `K_epoch+1`.
- Owner wraps that key for each approved member's pubkey (fetched from contract state, not offchain storage) + an owner escrow entry.
- Owner publishes wrapped-key bundle to offchain encrypted storage.
- Contract stores only a key bundle reference + hash + `membershipVersion` via `EpochRotated` event.
- Members fetch their wrapped entry and unwrap locally with their private key.

### Rekey concurrency control
`rotateEpoch` requires `expectedMembershipVersion`. If membership changed between when the owner prepared the bundle and when the tx is mined, the transaction reverts. Owner retries with updated membership snapshot. This is the correct EVM pattern — mempool transactions do not hold locks.

---

## Historical Key Access
New joiners and recovered nodes obtain access to historical epochs via a **Historical Key Grant** issued by the owner:
- Owner re-wraps historical `K_epoch` values (recovered via owner escrow entries in past bundles) for the new member's pubkey.
- Resulting Historical Key Bundle is uploaded to offchain encrypted storage and referenced by `HistoricalKeyBundleGranted` event.
- New member can then decrypt any past backup or message from any granted epoch.

---

## Organization / Swarm / Agent Model
SoulVault keeps local state for three primary entities:
- **organization**
- **swarm**
- **agent**

### Organization
- optional ENS root name
- owner/treasury context
- visibility/discoverability posture
- zero or more linked swarms

### Swarm
Every swarm is identified by a contract address + chainId and belongs to one organization.
Recommended local profile fields:
- `organizationRef`
- `swarmName`
- `chainId`
- `contractAddress`
- `ownerAddress`
- optional ENS swarm name
- `active` flag

### Agent
- local wallet / public key / harness profile
- optional ERC-8004 registration metadata
- may participate in multiple swarms

SoulVault commands execute against the active organization/swarm unless explicit flags are provided.
The `.env` file should supply defaults, but canonical organization/swarm state lives in local SoulVault state under `~/.soulvault/`.

---

## Event-Driven Control Loop
SoulVault listens for:
- `JoinRequested` — owner: review and approve
- `JoinApproved` — owner: trigger rekey prompt; new member: trigger restore
- `MemberRemoved` — owner: trigger rekey prompt
- `EpochRotated` — all members: fetch and unwrap new wrapped key
- backup file mapping update event — all members: awareness of latest per-member backup merkle root / tx hash / storage locator
- `HistoricalKeyBundleGranted` — target member: fetch and unwrap historical keys
- `AgentMessagePosted` — members: fetch and decrypt message payload from offchain storage
- `BackupRequested` — members: trigger local backup flow and publish updated file mappings
- `AgentManifestUpdated` — informational: agent environment metadata updated
- `RekeyRequested` — post-MVP Chainlink signal: owner acts on rekey prompt

Additionally, the CLI MAY sync selected public metadata into an ERC-8004 identity record per agent:
- create/update per-agent ERC-8004 identity
- publish/update base64 `agentURI`
- inject optional harness metadata during registration
- publish per-swarm backup file mapping after each backup run
- publish/update public-safe environment manifest/profile pointers
- optionally attach ERC-8004 registry coordinates to local/member metadata for indexers

This avoids polling-heavy UX and makes all coordination auditable onchain.

---

## Public Identity vs Private Coordination
SoulVault uses a three-layer public/private model:

- **Public namespace layer (ENS):** optional organization, swarm, and agent naming/discovery
- **Public identity layer (ERC-8004, Model 1):** one ERC-8004 registration per agent. This is for discovery, public metadata, public endpoints, reputation, and validation hooks.
- **Private coordination layer (SoulVault):** membership, epoch keys, encrypted backups, encrypted message payloads, and historical recovery.

SoulVault does **not** require ERC-8004 registration for joins in MVP. ERC-8004 is an interoperability and discoverability layer, not an admission prerequisite.

Recommended public fields for each agent's ERC-8004 registration file:
- `name`, `description`, `image`
- `services[]` entries for `web`, `A2A`, `MCP`, and optional `SoulVault`
- `supportedTrust[]`
- optional custom `soulvault` object with:
  - `swarmId`
  - `swarmContract`
  - `memberAddress`
  - `publicManifestUri`
  - `joinedEpoch`
  - `role`
  - `harness`
  - `backupHarnessCommand`

Only public-safe references belong in ERC-8004. Wrapped keys, internal backup pointers, private topology, and other confidential swarm state remain exclusively in SoulVault.

## Verified Messaging via Contract Events
Contract events serve as a verified messaging layer between agents:
- Sender identity is tied to wallet address (must be an approved member).
- Message references (storage ref/hash/topic/seq/epoch) are immutable and timestamped onchain.
- Recipients can verify source, sequence, and epoch from chain history.
- `epoch` must equal `currentEpoch` at time of posting — no cross-epoch message ambiguity.

Payloads are encrypted with current `K_epoch` and stored in the configured encrypted storage backend (0G for backups/memories in MVP). All swarm members can decrypt any message payload. Only metadata is emitted onchain.

---

## 0G Storage Responsibility
**MVP:** SoulVault writes encrypted memories/backups to 0G Storage. After upload, the CLI records a verifiable file mapping for each swarm membership that includes the storage locator, merkle root, and publishing transaction hash.

**Post-MVP / SaaS:** Managed services may mirror or index 0G-backed artifacts for convenience, but 0G remains the canonical encrypted storage layer for memories/backups.

---

## WireGuard / Relay Integration (Post-MVP)
- Contract/events are the authorization plane, not the transport plane.
- Do not use `K_epoch` directly as a tunnel transport key.
- On join/epoch changes, SoulVault triggers network credential refresh (SSH certs/WireGuard peers).
- Optional relay/control-plane facilitates NAT traversal for outbound-only peers.
- This layer is intentionally excluded from MVP to keep scope tight.
