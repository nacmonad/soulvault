# SoulVault Protocol v0.1 (MVP-Oriented)

## Goal
Define a minimal, implementable protocol for:
1. Swarm membership and approvals
2. Epoch key rotation on membership changes
3. Encrypted backup/message distribution via 0G Storage
4. Event-driven coordination through onchain metadata
5. Historical key access for new and recovered joiners
6. Optional public agent identity interoperability via ERC-8004 (Model 1: one ERC-8004 identity per agent)

---

## 1) Core Principles

- **No plaintext onchain**
- **No plaintext in remote storage**
- **No symmetric keys onchain**
- **Membership controls future access** (via epoch rotation)
- **Past access is not revoked for removed members** (practical assumption — existing local copies may persist)
- **New and recovered joiners can be granted access to historical epochs** (via owner-escrowed rewrap)
- **All approved members share the same `K_epoch`** (swarm-readable model — deliberate design decision enabling the coordination layer)
- **Public identity is separate from private coordination**: ERC-8004 may expose discoverable agent identity and public metadata, but never replaces SoulVault membership, rekey, or encrypted-state flows

---

## 2) Actors

- **Owner**: deploys swarm contract, approves joins, holds owner escrow key, triggers rekey operations from CLI. Ledger-class signer support is a recommended later path, not an MVP requirement.
- **Member Agent**: approved participant in swarm using an agent-local software wallet in MVP
- **SoulVault CLI**: offchain orchestrator (watches events, encrypts/decrypts, wraps/unwraps keys, triggers rekey, issues historical key grants, creates/updates ERC-8004 identities, runs scheduled harness-aware backups)
- **0G Storage**: stores encrypted memories/backups and related ciphertext artifacts

---

## 2.5) ERC-8004 Identity Model (Model 1)

SoulVault adopts **Model 1** for ERC-8004 integration:
- each agent MAY register its own ERC-8004 identity
- swarm membership remains governed solely by the SoulVault swarm contract
- ERC-8004 is used for public identity, discovery, reputation, and validation hooks
- ERC-8004 registration is OPTIONAL for MVP joins and restores

### Identity layering
For a given agent, the layers are:
1. **ERC-8004 identity** — portable public identity + base64-encoded `agentURI`
2. **Agent wallet** — control/payment/admin identity
3. **SoulVault member pubkey** — wrapping/decryption identity used in join + rekey flows
4. **SoulVault manifests/profiles** — capabilities and swarm-scoped metadata

MVP signer guidance:
- agent runtime uses a local software wallet (`mnemonic` or `private-key` signer mode)
- the same agent wallet can own the ERC-8004 identity under Model 1 / Option A
- owner/governance flows may later use Ledger without changing the contract model because the contract keys on addresses, not signer backend type

### What goes in ERC-8004
Allowed / recommended public fields:
- `name`, `description`, `image`
- `services[]` entries such as `web`, `A2A`, `MCP`, optional `SoulVault`, `ENS`, `DID`
- `supportedTrust[]`
- public-safe capability/profile pointers
- optional custom `soulvault` object referencing the swarm and public-safe metadata

Not suitable for ERC-8004:
- wrapped epoch keys
- internal backup pointers used for recovery
- encrypted payload locations that should stay swarm-private
- private hostnames, private IPs, secrets, or internal topology

## 3) Swarm State Model

Per swarm contract:
- `owner`
- `paused`
- `currentEpoch` (uint64)
- `membershipVersion` (uint64 — increments on every join approval or member removal; used for rekey concurrency control)
- `members[address] => { active, pubkey (bytes), joinedEpoch }`
- `joinRequests[requestId] => { requester, pubkey, pubkeyRef, metadataRef, status }`
- `latestBackupPointer` or per-member backup file mapping (storage locator, merkleRoot, publishTxHash, manifestHash, epoch)

> **Critical:** Member `pubkey` is stored directly in the join request struct (submitted in calldata) and copied into the member record at approval time. This eliminates any dependency on offchain storage availability during rekey operations — the owner can always fetch pubkeys directly from contract state.

### Local CLI state (per swarm)
- active chain + contract address
- local agent keypair
- known epoch keys (local secure store, indexed by epoch number)
- last processed event block

---

## 4) Data Objects (Offchain)

### 4.1 Encrypted Backup Bundle
State is organized as:
- **Shared bundle** (swarm-common artifacts)
- **Agent bundle(s)** (agent-specific soul/memory profiles)

Typical files in agent bundles:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- selected memory/skill/config files

All agent bundles are encrypted under the shared `K_epoch` and are readable by all approved swarm members. This is a **deliberate design decision** — shared epoch-key access enables the coordination layer where agents can read each other's memory/state when needed for collaborative tasks. Post-MVP, per-agent derived keys (`K_agent = HKDF(K_epoch, "agent", agentAddress)`) can introduce private agent state alongside shared swarm state.

### 4.2 Manifest
- file list
- file hashes (per file)
- archive hash
- createdAt
- epoch
- encryption metadata

### 4.2.1 Public Agent Profile / ERC-8004 Registration Payload
Each agent MAY also publish a **public** registration/profile document for its ERC-8004 identity. This is distinct from encrypted backup manifests.

Recommended structure:
- ERC-8004 standard fields (`type`, `name`, `description`, `image`, `services`, `registrations`, `supportedTrust`)
- optional `soulvault` extension object with:
  - `swarmId`
  - `swarmContract`
  - `memberAddress`
  - `publicManifestUri`
  - `publicManifestHash`
  - `joinedEpoch`
  - `role`
  - `harness`

This file is intended for public discovery and SHOULD contain only public-safe metadata. For MVP, `agentURI` is expected to be a base64-encoded data URI containing this JSON directly.

### 4.3 Wrapped Epoch Key Bundle
For each approved member in epoch E:
- `recipientAddress`
- `wrappedKey` (`K_epoch` encrypted to member's stored pubkey)
- `wrapperAlgo` (required — e.g., `"x25519-xsalsa20-poly1305"` via libsodium box)

Additionally, every bundle includes:
- `ownerEscrowEntry: { wrappedKey, wrapperAlgo }` — `K_epoch` wrapped to the owner's key, enabling historical recovery for any epoch

Stored offchain, referenced onchain by hash/locator via `EpochRotated` event.

### 4.4 Historical Key Bundle
A collection of per-epoch wrapped key entries issued to a specific member covering epochs they did not participate in:
```json
[
  { "epoch": 0, "wrappedKey": "...", "wrapperAlgo": "x25519-xsalsa20-poly1305" },
  { "epoch": 1, "wrappedKey": "...", "wrapperAlgo": "x25519-xsalsa20-poly1305" }
]
```
Generated by owner CLI, uploaded to encrypted storage, referenced onchain via `HistoricalKeyBundleGranted` event. This is the mechanism that gives new joiners and recovered nodes access to past encrypted state — including historical bot configurations and prior epoch backups.

---

## 5) Epoch Key Rotation (Rekey)

Use an **epoch group key** (`K_epoch`) — not pairwise double-ratchet. One key per epoch, shared by all approved members.

**`K_epoch` is used directly** for both backup encryption and message payload encryption in MVP. This is a deliberate simplicity choice that avoids key derivation complexity. Post-MVP, purpose-separated derived keys via HKDF are recommended:
- `K_backup = HKDF(K_epoch, "backup")`
- `K_msg    = HKDF(K_epoch, "message")`

### Trigger conditions
- Join approved
- Member removed
- Manual security rotate (owner CLI: `soulvault epoch rotate`)
- Swarm backup trigger event (`requestBackup`) for coordinated state publication
- Scheduled backup execution (heartbeat-driven or system cron-driven) as fallback

### Who triggers rekey
**MVP:** The owner initiates rekey manually from the SoulVault CLI. This is deliberate — the owner holds the escrow key and must sign the `rotateEpoch` transaction. The CLI watches for `JoinApproved` and `MemberRemoved` events and prompts the owner to trigger a rekey when membership changes are detected.

**Post-MVP (Chainlink Automation):** Chainlink can watch onchain conditions and call a public `requestRekey()` function to emit a `RekeyRequested(trigger, membershipVersion)` event when a membership change has gone unrekeyted for too long, or when a stale backup is detected. The owner CLI watches for `RekeyRequested` and initiates the rekey. **Chainlink cannot execute the rekey — it does not hold the owner's private key.** It is a trigger/alerting mechanism only.

### Rekey concurrency control
The EVM does not support mempool-level locking. Transactions do not "reserve" state while in the mempool — they execute atomically when mined, in arrival order. The correct EVM pattern for this is **optimistic concurrency control**: snapshot membership state, build the bundle, then validate at commit time.

The `membershipVersion` counter enables this:

1. Owner CLI reads current `membershipVersion` from contract.
2. Owner generates fresh `K_epoch+1`.
3. Owner fetches all active member pubkeys directly from contract state (no offchain storage lookup required).
4. Owner wraps `K_epoch+1` for each active member pubkey + owner escrow entry.
5. Owner uploads wrapped-key bundle to encrypted storage.
6. Owner calls `rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion)`.
7. Contract checks: `require(membershipVersion == expectedMembershipVersion, "MembershipChanged")`.
8. If a join or kick occurred between steps 1 and 6, the transaction **reverts**. Owner re-reads updated membership and rebuilds the bundle.
9. On success: contract increments `currentEpoch`, increments `membershipVersion`, emits `EpochRotated`.
10. Members fetch their wrapped entry from the new bundle and unwrap locally.

> A reverted rekey is cheap and entirely safe — it simply means the owner must re-snapshot and retry with the correct membership set.

### Access effect
- Removed members cannot decrypt epoch+ content.
- Existing local copies of older plaintext remain (accepted limitation for MVP).

---

## 6) Join Lifecycle

### 6.1 First Join (root trust)
1. Agent generates local keypair on the node (never leaves the machine).
2. Agent calls `requestJoin(pubkey, pubkeyRef, metadataRef)`.
   - `pubkey` is the agent's raw asymmetric public key (bytes), stored in calldata and emitted in `JoinRequested`. There is no secure out-of-band channel needed — the pubkey is not a secret.
   - `pubkeyRef` is an optional offchain reference pointing to extended key metadata or a signed key declaration.
   - `metadataRef` points to any additional agent metadata.
3. Owner approves via `soulvault join approve <requestId>`.
4. Contract activates agent, stores `pubkey` in the member record, increments `membershipVersion`, emits `JoinApproved`.
5. Owner triggers rekey (`soulvault epoch rotate`) to establish the new shared operational epoch.

### 6.2 Subsequent Joins (MVP)
Owner approval path only. Same flow as 6.1.

### 6.3 Historical Key Grant (new and recovered joiners)
When a newly approved or recovering member needs to read state from epochs before their join, the owner issues a Historical Key Grant:

1. Owner CLI: `soulvault keygrant --member <address> --from-epoch <N>`
2. Owner fetches each historical wrapped-key bundle (epochs N through current-1) from encrypted storage.
3. Owner unwraps each historical `K_epoch` using the `ownerEscrowEntry` in each bundle.
4. Owner re-wraps each historical `K_epoch` for the new member's pubkey (read from contract state — no offchain storage lookup needed).
5. Owner bundles all re-wrapped entries into a Historical Key Bundle and uploads to encrypted storage.
6. Owner calls `grantHistoricalKeys(memberAddress, bundleRef, bundleHash, fromEpoch, toEpoch)`.
7. Contract emits `HistoricalKeyBundleGranted(member, bundleRef, bundleHash, fromEpoch, toEpoch)`.
8. New member CLI detects event, fetches bundle from offchain encrypted storage, unwraps each epoch key locally into secure store.
9. Member can now decrypt any backup or message encrypted under any epoch from `fromEpoch` through `toEpoch`.

This gives new joiners the **full historical scope** of the swarm project. Banned/removed nodes cannot decrypt new epochs because they are excluded from future wrapped-key bundles — forward secrecy is preserved from the rekey point onward.

### 6.4 Future Quorum
M-of-N approvals via onchain votes or EIP-712 admission tickets.

---

## 7) Message Bus Protocol (Verified Events)

### 7.1 Design
- Onchain: message metadata only
- Offchain: encrypted payload (storage backend; 0G for memories/backups in MVP)

### 7.2 Contract method
`postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)`

Checks:
- Sender is an active member
- Swarm is not paused
- `seq` is greater than last recorded sender seq (per-sender replay protection)
- `epoch` must equal `currentEpoch` (no cross-epoch message ambiguity)

Event:
`AgentMessagePosted(from, to, topic, seq, epoch, payloadRef, payloadHash, ttl, timestamp)`

### 7.3 Payload encryption
- Encrypt payload directly with current `K_epoch` (XChaCha20-Poly1305 via libsodium).
- Include metadata in AAD: `from/to/topic/seq/epoch`.
- All approved members can decrypt any message payload (swarm-readable model).

---

## 8) Backup / Restore Protocol

### 8.1 Backup
The preferred trigger is a swarm event emitted through `requestBackup(...)`, not cron. Cron / `HEARTBEAT.md` remain fallback mechanisms.

1. Resolve the backup harness command from SoulVault config / agent metadata. In MVP, use trusted local harness adapter commands for supported harnesses:
   - `openclaw` -> `soulvault-harness-openclaw backup`
   - `hermes` -> `soulvault-harness-hermes backup`
   - `ironclaw` -> `soulvault-harness-ironclaw backup`
   This may be triggered by `BackupRequested`, or scheduled from `HEARTBEAT.md` / system cron as fallback.
2. Run the harness-specific backup command, producing a deterministic archive (tar/gzip) or equivalent bundle.
3. Compute per-file hashes + archive hash + manifest + merkle root.
4. Encrypt archive directly with `K_epoch` (XChaCha20-Poly1305 via libsodium). For CLI integration testing before full swarm key distribution is wired, a local `TEST_K_EPOCH` constant / env-backed override may be used.
5. Upload ciphertext + manifest to 0G Storage; verify content availability before calling contracts.
6. For each swarm the agent is a member of, publish the resulting file mapping onchain, including storage locator, merkle root, publish transaction hash, and manifest hash.
7. Mark the run as the latest successful backup publication for that agent/swarm pair.

> Post-MVP: derive `K_backup = HKDF(K_epoch, "backup", agentAddress)` for key-purpose separation.

### 8.2 Restore (latest)
1. Confirm caller is an active member (or owner performing recovery).
2. Read `latestBackupPointer` + `currentEpoch` from contract.
3. Fetch wrapped-key bundle reference from latest `EpochRotated` event; unwrap `K_epoch` locally using private key.
4. Fetch encrypted backup and manifest from 0G Storage (using the recorded file mapping / storage locator).
5. Decrypt and verify all hashes (manifest hash + per-file hashes).
6. Write files to workspace and start OpenClaw.

### 8.3 Historical Restore
To restore from a past epoch's backup:
1. Obtain historical `K_epoch` via Historical Key Bundle (section 6.3).
2. Look up the member file mapping for that epoch from historical `MemberFileMappingUpdated` events.
3. Fetch and decrypt as normal using that epoch's key.

---

## 9) Bootstrap Strategy (MVP)

Recommended: bootstrap script distributed with CLI release (not fetched from remote storage).

Flow:
1. Install dependencies + SoulVault CLI.
2. Configure swarm contract context (`soulvault swarm use <name>`).
3. Generate local agent keypair.
4. Submit join request onchain (pubkey included in calldata).
5. Wait for `JoinApproved` event.
6. If historical access is needed, wait for `HistoricalKeyBundleGranted` event from owner.
7. Perform restore (latest or historical as applicable).

Security:
- Distribute bootstrap script with checksum/signature.
- Avoid dynamic remote script execution unless hash-pinned.

---

## 10) Key Loss / VPS Nuke Recovery

### Problem scenario
A member VPS is fully lost and its local private key is unrecoverable. That node can no longer unwrap prior wrapped epoch keys directly.

### Design rule
The smart contract does **not** regenerate historical symmetric keys. It governs authorized recovery/rekey operations and records storage references only.

### MVP recovery path (Owner Escrow)
Every wrapped-key bundle includes an `ownerEscrowEntry` (`K_epoch` wrapped to the owner's key). The owner can therefore recover any epoch's key material at any time, for any member.

Recovery flow:
1. New VPS generates a fresh agent keypair.
2. New VPS submits `requestJoin(pubkey, pubkeyRef, metadataRef)`.
3. Owner approves re-join and triggers a normal rekey (new epoch established).
4. Owner runs `soulvault keygrant --member <newAddress> --from-epoch 0` to grant full historical access.
5. New VPS fetches Historical Key Bundle, unwraps each epoch key into local secure store, and restores from desired backup.

### Quorum escrow path (Post-MVP)
Protect against owner key loss via threshold shares (e.g., Shamir secret sharing) among trusted operators/members. Recovery requires M-of-N participants to reconstruct/authorize re-wrap.

### Ledger wallet note
Hardware wallets (Ledger-class) are strongly recommended for owner escrow key operations to prevent software exposure.

---

## 11) 0G Storage Availability and Publication Responsibility

### MVP Policy
For MVP, encrypted memories/backups are uploaded to **0G Storage** and treated as the canonical remote backup store.

The SoulVault CLI must:
- encrypt before upload
- capture the resulting storage locator and publish transaction hash
- compute and retain a merkle root for the uploaded artifact set
- write the per-member backup file mapping into every swarm contract the agent belongs to

### Post-MVP / SaaS Path
Managed services may mirror, index, or accelerate retrieval, but the canonical backup publication flow remains: local harness backup -> XChaCha encryption -> 0G upload -> onchain file mapping publication.

---

## 12) SSH / Tunnel Revalidation Model (Future-safe)

Do **not** reuse `K_epoch` as a tunnel transport key directly. Use membership/epoch events as authorization signals for issuing short-lived access credentials (SSH certs, WireGuard peer entries, API tokens). On epoch rotate or member kick, credentials expire and nodes revalidate via latest membership state.

---

## 13) Chainlink Integration (MVP+)

### Best fit: Chainlink Automation
Chainlink Automation watches onchain conditions and calls a public `requestRekey()` function to emit `RekeyRequested(trigger, membershipVersion)` when:
- A `JoinApproved` or `MemberRemoved` event occurred but no `EpochRotated` followed within a defined block window.
- No `MemberFileMappingUpdated` has occurred within a configured staleness threshold.
- A manual rotate reminder interval has elapsed.

**Critical limitation:** Chainlink cannot execute the rekey itself — it does not hold the owner's private key and cannot generate or wrap `K_epoch`. It is a trigger/alerting mechanism only. The owner CLI responds to `RekeyRequested` events and performs actual key generation and rotation.

### What Chainlink does not do
- Hold or access any private or symmetric keys
- Directly decrypt any payload
- Execute rekey crypto operations

### CCIP note
Cross-chain messaging is only needed if a swarm spans multiple chains. Out of MVP scope.

---

## 14) Minimal Event Schema

- `JoinRequested(requestId, requester, pubkey, pubkeyRef, metadataRef)`
- `JoinApproved(requestId, requester, approver, epoch)`
- `MemberRemoved(member, by, epoch)`
- `EpochRotated(oldEpoch, newEpoch, keyBundleRef, keyBundleHash, membershipVersion)`
- `MemberFileMappingUpdated(member, epoch, storageLocator, merkleRoot, publishTxHash, manifestHash, by)`
- `AgentMessagePosted(from, to, topic, seq, epoch, payloadRef, payloadHash, ttl, timestamp)`
- `BackupRequested(requestedBy, epoch, reason, targetRef, deadline, timestamp)`
- `AgentManifestUpdated(agent, manifestRef, manifestHash, timestamp)`
- `HistoricalKeyBundleGranted(member, bundleRef, bundleHash, fromEpoch, toEpoch)`
- `RekeyRequested(trigger, membershipVersion)` *(post-MVP Chainlink signal)*
- `Paused(by)` / `Unpaused(by)`

---

## 15) Agent Environment Manifests (Roadmap)

Agents may publish signed environment manifests (CPU/GPU/RAM/tooling/availability) to support future task delegation.

Recommended split:
1. **Private/full manifest** — may remain SoulVault-only when it contains sensitive operational detail.
2. **Public-safe manifest** — suitable for linking from the agent's ERC-8004 `agentURI` registration/profile.

Recommended flow:
1. Agent signs manifest hash with swarm identity key.
2. Manifest uploaded to the chosen storage backend (0G for encrypted/private backup artifacts in MVP; public-safe registration metadata may be embedded directly in base64 `agentURI`).
3. Contract stores storage reference/hash pointer; emits `AgentManifestUpdated`.
4. If the agent has an ERC-8004 identity, its public registration file MAY be refreshed to point at the new public-safe manifest URI/hash.

MVP note: Manifest support is included as **registration metadata** (publish/update pointer + event). Manifests remain informational in MVP and do not gate join/restore operations.

## 15.1 ERC-8004 metadata conventions for SoulVault

Recommended custom fields / metadata keys for an ERC-8004-registered SoulVault agent:
- `soulvault.swarmId`
- `soulvault.swarmContract`
- `soulvault.memberAddress`
- `soulvault.publicManifestUri`
- `soulvault.publicManifestHash`
- `soulvault.role`
- `soulvault.harness`
- `soulvault.backupHarnessCommand`
- `soulvault.joinedEpoch`

The `harness` field is a SoulVault convention, not an ERC-8004-required standard field. It can describe execution/runtime flavor such as `openclaw`, `hermes`, or another agent framework.

---

## 16) MVP Boundaries

Must-have:
- Owner-gated joins with pubkey in calldata (no offchain storage dependency for pubkey resolution)
- `membershipVersion` counter on contract for rekey concurrency control
- Epoch rotation on join/kick/manual trigger (owner CLI)
- Wrapped-key bundles in offchain encrypted storage including `ownerEscrowEntry` per epoch
- `K_epoch` used directly for backup and message encryption
- Historical Key Grant CLI command + `grantHistoricalKeys` contract method + `HistoricalKeyBundleGranted` event
- Event-driven messaging metadata + encrypted payload refs
- CLI watcher + multi-swarm context
- backup publication flow to 0G Storage plus onchain per-member file mapping writes across all joined swarms
- ERC-8004 helper flow for per-agent registration with optional harness metadata

Can defer:
- Chainlink automation triggers (`RekeyRequested`)
- HKDF-derived purpose keys
- Quorum voting
- Treasury automation
- Cross-chain (CCIP)
- Advanced tunnel/WireGuard orchestration
- Per-agent private derived keys
