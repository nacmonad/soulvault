# SoulVault Protocol v0.1 (MVP-Oriented)

## Goal
Define a minimal, implementable protocol for:
1. Swarm membership and approvals
2. Epoch key rotation on membership changes
3. Encrypted backup/message distribution via IPFS
4. Event-driven coordination through onchain metadata
5. Historical key access for new and recovered joiners

---

## 1) Core Principles

- **No plaintext onchain**
- **No plaintext on IPFS**
- **No symmetric keys onchain**
- **Membership controls future access** (via epoch rotation)
- **Past access is not revoked for removed members** (practical assumption — existing local copies may persist)
- **New and recovered joiners can be granted access to historical epochs** (via owner-escrowed rewrap)
- **All approved members share the same `K_epoch`** (swarm-readable model — deliberate design decision enabling the coordination layer)

---

## 2) Actors

- **Owner**: deploys swarm contract, approves joins, holds owner escrow key, triggers rekey operations from CLI
- **Member Agent**: approved participant in swarm
- **SoulVault CLI**: offchain orchestrator (watches events, encrypts/decrypts, wraps/unwraps keys, triggers rekey, issues historical key grants)
- **IPFS**: stores all ciphertext artifacts (wrapped key bundles, encrypted backups, manifests); pinned by owner or pinning service

---

## 3) Swarm State Model

Per swarm contract:
- `owner`
- `paused`
- `currentEpoch` (uint64)
- `membershipVersion` (uint64 — increments on every join approval or member removal; used for rekey concurrency control)
- `members[address] => { active, pubkey (bytes), joinedEpoch }`
- `joinRequests[requestId] => { requester, pubkey, pubkeyRef, metadataCid, status }`
- **Backup pointer(s)** onchain — see [On-chain backup pointer shape](#on-chain-backup-pointer-shape) below

> **Critical:** Member `pubkey` is stored directly in the join request struct (submitted in calldata) and copied into the member record at approval time. This eliminates any dependency on IPFS availability during rekey operations — the owner can always fetch pubkeys directly from contract state.

### On-chain backup pointer shape

Off-chain, backups split into **shared swarm** bundles and **per-agent** bundles (see §4.1); **MVP crypto** still uses one **`K_epoch`** for all of them (any approved member could decrypt any ciphertext if they fetch the blob).

On-chain coordination can expose **where** the latest ciphertext lives in either of these equivalent patterns:

1. **Single swarm head (minimal storage sketch)** — One `latestBackupPointer` field: `(bundleCid, manifestCid, manifestHash, epoch)`. Think **one `HEAD`**: each update overwrites the previous onchain “current” snapshot. Works when you treat backups as a **single global checkpoint** (e.g. one merged publish pipeline) or when **history is enough** in **`BackupPointerUpdated` logs** and the storage slot is only a cheap cache of the newest update.

2. **Per-member heads (recommended for parallel agents)** — `memberBackupPointers[member] => { bundleCid, manifestCid, manifestHash, epoch }`. Each approved agent advances **only their own** row (e.g. `setMyBackupPointer` gated by `msg.sender`). Think **one branch tip per member**: many concurrent “latest” backups without clobbering each other. Still consistent with §4.1 — **shared key**, **per-agent artifacts** and pointers.

Implementations may choose (2) for MVP when multiple agents publish independently; (1) remains valid for owner-centric or monolithic backup UX. Indexers and tooling should key off **`BackupPointerUpdated`** (include **`member`** when using per-member storage).

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

### 4.3 Wrapped Epoch Key Bundle
For each approved member in epoch E:
- `recipientAddress`
- `wrappedKey` (`K_epoch` encrypted to member's stored pubkey)
- `wrapperAlgo` (required — e.g., `"x25519-xsalsa20-poly1305"` via libsodium box)

Additionally, every bundle includes:
- `ownerEscrowEntry: { wrappedKey, wrapperAlgo }` — `K_epoch` wrapped to the owner's key, enabling historical recovery for any epoch

Stored offchain (IPFS), referenced onchain by CID/hash via `EpochRotated` event.

### 4.4 Historical Key Bundle
A collection of per-epoch wrapped key entries issued to a specific member covering epochs they did not participate in:
```json
[
  { "epoch": 0, "wrappedKey": "...", "wrapperAlgo": "x25519-xsalsa20-poly1305" },
  { "epoch": 1, "wrappedKey": "...", "wrapperAlgo": "x25519-xsalsa20-poly1305" }
]
```
Generated by owner CLI, uploaded to IPFS, referenced onchain via `HistoricalKeyBundleGranted` event. This is the mechanism that gives new joiners and recovered nodes access to past encrypted IPFS state — including historical bot configurations and prior epoch backups.

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

### Who triggers rekey
**MVP:** The owner initiates rekey manually from the SoulVault CLI. This is deliberate — the owner holds the escrow key and must sign the `rotateEpoch` transaction. The CLI watches for `JoinApproved` and `MemberRemoved` events and prompts the owner to trigger a rekey when membership changes are detected.

**Post-MVP (Chainlink Automation):** Chainlink can watch onchain conditions and call a public `requestRekey()` function to emit a `RekeyRequested(trigger, membershipVersion)` event when a membership change has gone unrekeyted for too long, or when a stale backup is detected. The owner CLI watches for `RekeyRequested` and initiates the rekey. **Chainlink cannot execute the rekey — it does not hold the owner's private key.** It is a trigger/alerting mechanism only.

### Rekey concurrency control
The EVM does not support mempool-level locking. Transactions do not "reserve" state while in the mempool — they execute atomically when mined, in arrival order. The correct EVM pattern for this is **optimistic concurrency control**: snapshot membership state, build the bundle, then validate at commit time.

The `membershipVersion` counter enables this:

1. Owner CLI reads current `membershipVersion` from contract.
2. Owner generates fresh `K_epoch+1`.
3. Owner fetches all active member pubkeys directly from contract state (no IPFS required).
4. Owner wraps `K_epoch+1` for each active member pubkey + owner escrow entry.
5. Owner uploads wrapped-key bundle to IPFS.
6. Owner calls `rotateEpoch(newEpoch, keyBundleCid, keyBundleHash, expectedMembershipVersion)`.
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
2. Agent calls `requestJoin(pubkey, pubkeyRef, metadataCid)`.
   - `pubkey` is the agent's raw asymmetric public key (bytes), stored in calldata and emitted in `JoinRequested`. There is no secure out-of-band channel needed — the pubkey is not a secret.
   - `pubkeyRef` is an optional IPFS CID pointing to extended key metadata or a signed key declaration.
   - `metadataCid` points to any additional agent metadata.
3. Owner approves via `soulvault join approve <requestId>`.
4. Contract activates agent, stores `pubkey` in the member record, increments `membershipVersion`, emits `JoinApproved`.
5. Owner triggers rekey (`soulvault epoch rotate`) to establish the new shared operational epoch.

### 6.2 Subsequent Joins (MVP)
Owner approval path only. Same flow as 6.1.

### 6.3 Historical Key Grant (new and recovered joiners)
When a newly approved or recovering member needs to read state from epochs before their join, the owner issues a Historical Key Grant:

1. Owner CLI: `soulvault keygrant --member <address> --from-epoch <N>`
2. Owner fetches each historical wrapped-key bundle (epochs N through current-1) from IPFS.
3. Owner unwraps each historical `K_epoch` using the `ownerEscrowEntry` in each bundle.
4. Owner re-wraps each historical `K_epoch` for the new member's pubkey (read from contract state — no IPFS needed).
5. Owner bundles all re-wrapped entries into a Historical Key Bundle and uploads to IPFS.
6. Owner calls `grantHistoricalKeys(memberAddress, bundleCid, bundleHash, fromEpoch, toEpoch)`.
7. Contract emits `HistoricalKeyBundleGranted(member, bundleCid, bundleHash, fromEpoch, toEpoch)`.
8. New member CLI detects event, fetches bundle from IPFS, unwraps each epoch key locally into secure store.
9. Member can now decrypt any backup or message encrypted under any epoch from `fromEpoch` through `toEpoch`.

This gives new joiners the **full historical scope** of the swarm project. Banned/removed nodes cannot decrypt new epochs because they are excluded from future wrapped-key bundles — forward secrecy is preserved from the rekey point onward.

### 6.4 Future Quorum
M-of-N approvals via onchain votes or EIP-712 admission tickets.

---

## 7) Message Bus Protocol (Verified Events)

### 7.1 Design
- Onchain: message metadata only
- Offchain: encrypted payload (IPFS)

### 7.2 Contract method
`postMessage(to, topic, seq, epoch, payloadCid, payloadHash, ttl)`

Checks:
- Sender is an active member
- Swarm is not paused
- `seq` is greater than last recorded sender seq (per-sender replay protection)
- `epoch` must equal `currentEpoch` (no cross-epoch message ambiguity)

Event:
`AgentMessagePosted(from, to, topic, seq, epoch, payloadCid, payloadHash, ttl, timestamp)`

### 7.3 Payload encryption
- Encrypt payload directly with current `K_epoch` (XChaCha20-Poly1305 via libsodium).
- Include metadata in AAD: `from/to/topic/seq/epoch`.
- All approved members can decrypt any message payload (swarm-readable model).

---

## 8) Backup / Restore Protocol

### 8.1 Backup
1. Build deterministic archive (tar/gzip).
2. Compute per-file hashes + archive hash + manifest.
3. Encrypt archive directly with `K_epoch` (XChaCha20-Poly1305 via libsodium).
4. Upload ciphertext + manifest to IPFS; verify content availability before calling contract.
5. Record the pointer onchain:
   - **Single-head layout:** `setLatestBackupPointer(epoch, bundleCid, manifestCid, manifestHash)`, or
   - **Per-member layout:** `setMyBackupPointer(bundleCid, manifestCid, manifestHash, epoch)` (member-signed; updates only `msg.sender`’s row).

> Post-MVP: derive `K_backup = HKDF(K_epoch, "backup", agentAddress)` for key-purpose separation.

### 8.2 Restore (latest)
1. Confirm caller is an active member (or owner performing recovery).
2. Read the backup pointer for the target: **`latestBackupPointer`** (single-head layout) **or** **`memberBackupPointers[targetAddress]`** (per-member layout), and `currentEpoch` from contract as needed.
3. Fetch wrapped-key bundle CID from latest `EpochRotated` event; unwrap `K_epoch` locally using private key.
4. Fetch encrypted backup and manifest from IPFS.
5. Decrypt and verify all hashes (manifest hash + per-file hashes).
6. Write files to workspace and start OpenClaw.

### 8.3 Historical Restore
To restore from a past epoch's backup:
1. Obtain historical `K_epoch` via Historical Key Bundle (section 6.3).
2. Look up backup pointer for that epoch from historical `BackupPointerUpdated` events.
3. Fetch and decrypt as normal using that epoch's key.

---

## 9) Bootstrap Strategy (MVP)

Recommended: bootstrap script distributed with CLI release (not fetched from IPFS).

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
The smart contract does **not** regenerate historical symmetric keys. It governs authorized recovery/rekey operations and records CID references only.

### MVP recovery path (Owner Escrow)
Every wrapped-key bundle includes an `ownerEscrowEntry` (`K_epoch` wrapped to the owner's key). The owner can therefore recover any epoch's key material at any time, for any member.

Recovery flow:
1. New VPS generates a fresh agent keypair.
2. New VPS submits `requestJoin(pubkey, pubkeyRef, metadataCid)`.
3. Owner approves re-join and triggers a normal rekey (new epoch established).
4. Owner runs `soulvault keygrant --member <newAddress> --from-epoch 0` to grant full historical access.
5. New VPS fetches Historical Key Bundle, unwraps each epoch key into local secure store, and restores from desired backup.

### Quorum escrow path (Post-MVP)
Protect against owner key loss via threshold shares (e.g., Shamir secret sharing) among trusted operators/members. Recovery requires M-of-N participants to reconstruct/authorize re-wrap.

### Ledger wallet note
Hardware wallets (Ledger-class) are strongly recommended for owner escrow key operations to prevent software exposure.

---

## 11) IPFS Availability and Pinning Responsibility

### MVP Policy
For MVP, the **owner is responsible for ensuring all CIDs referenced by swarm contract events are pinned and available**.

Owner options:
- Run a local IPFS node and pin all swarm CIDs.
- Use a managed pinning service (Pinata or Web3Storage SDK).

The SoulVault CLI includes a `soulvault ipfs pin-all` command that reads all CIDs from historical contract events and pins them via the configured provider. Content availability must be verified after every upload before updating contract pointers.

### Post-MVP / SaaS Path
A managed SoulVault relay/pinning service takes over availability responsibility. Multiple independent pinners provide redundancy. Service fees can be paid via swarm treasury (USDC). Open-source self-hosted mode remains available so operators are never locked into managed infrastructure.

---

## 12) SSH / Tunnel Revalidation Model (Future-safe)

Do **not** reuse `K_epoch` as a tunnel transport key directly. Use membership/epoch events as authorization signals for issuing short-lived access credentials (SSH certs, WireGuard peer entries, API tokens). On epoch rotate or member kick, credentials expire and nodes revalidate via latest membership state.

---

## 13) Chainlink Integration (MVP+)

### Best fit: Chainlink Automation
Chainlink Automation watches onchain conditions and calls a public `requestRekey()` function to emit `RekeyRequested(trigger, membershipVersion)` when:
- A `JoinApproved` or `MemberRemoved` event occurred but no `EpochRotated` followed within a defined block window.
- No `BackupPointerUpdated` has occurred within a configured staleness threshold.
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

- `JoinRequested(requestId, requester, pubkey, pubkeyRef, metadataCid)`
- `JoinApproved(requestId, requester, approver, epoch)`
- `MemberRemoved(member, by, epoch)`
- `EpochRotated(oldEpoch, newEpoch, keyBundleCid, keyBundleHash, membershipVersion)`
- `BackupPointerUpdated(member, epoch, bundleCid, manifestCid, manifestHash)` — `member` **indexed** when using per-member storage (MVP-friendly); for a single global head, `member` may be zero or omitted in an implementation that only tracks `by` / a singleton — prefer an explicit **`member`** field for unambiguous indexing
- `AgentMessagePosted(from, to, topic, seq, epoch, payloadCid, payloadHash, ttl, timestamp)`
- `AgentManifestUpdated(agent, manifestCid, manifestHash, timestamp)`
- `HistoricalKeyBundleGranted(member, bundleCid, bundleHash, fromEpoch, toEpoch)`
- `RekeyRequested(trigger, membershipVersion)` *(post-MVP Chainlink signal)*
- `Paused(by)` / `Unpaused(by)`

---

## 15) Agent Environment Manifests (Roadmap)

Agents may publish signed environment manifests (CPU/GPU/RAM/tooling/availability) to support future task delegation.

Recommended flow:
1. Agent signs manifest hash with swarm identity key.
2. Manifest uploaded to IPFS.
3. Contract stores CID/hash pointer; emits `AgentManifestUpdated`.

MVP note: Manifest support is included as **registration metadata** (publish/update pointer + event). Manifests remain informational in MVP and do not gate join/restore operations.

---

## 16) MVP Boundaries

Must-have:
- Owner-gated joins with pubkey in calldata (no IPFS dependency for pubkey resolution)
- `membershipVersion` counter on contract for rekey concurrency control
- Epoch rotation on join/kick/manual trigger (owner CLI)
- Wrapped-key bundles on IPFS including `ownerEscrowEntry` per epoch
- `K_epoch` used directly for backup and message encryption
- Historical Key Grant CLI command + `grantHistoricalKeys` contract method + `HistoricalKeyBundleGranted` event
- Event-driven messaging metadata + encrypted payload refs
- CLI watcher + multi-swarm context
- `soulvault ipfs pin-all` command; owner responsible for pinning

Can defer:
- Chainlink automation triggers (`RekeyRequested`)
- HKDF-derived purpose keys
- Quorum voting
- Treasury automation
- Cross-chain (CCIP)
- Advanced tunnel/WireGuard orchestration
- Per-agent private derived keys
