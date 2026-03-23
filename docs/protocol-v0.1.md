# SoulVault Protocol v0.1 (MVP-Oriented)

## Goal
Define a minimal, implementable protocol for:
1. Swarm membership and approvals
2. Epoch key rotation on membership changes
3. Encrypted backup/message distribution via IPFS
4. Event-driven coordination through onchain metadata

---

## 1) Core Principles

- **No plaintext onchain**
- **No plaintext on IPFS**
- **No symmetric keys onchain**
- **Membership controls future access** (via epoch rotation)
- **Past access is not revoked** (practical assumption)

---

## 2) Actors

- **Owner**: deploys swarm contract, approves first join, can emergency pause
- **Member Agent**: approved participant in swarm
- **SoulVault CLI**: offchain orchestrator (watch events, encrypt/decrypt, wrap keys)
- **IPFS**: ciphertext + wrapped key bundles + manifests

---

## 3) Swarm State Model

Per swarm contract:
- `owner`
- `paused`
- `currentEpoch` (uint64)
- `membershipVersion` (increment on join/kick)
- `members[address] => {active, pubkeyRef, joinedEpoch}`
- `joinRequests[requestId]`
- `latestBackupPointer` (CID/hash + epoch)

### Local CLI state (per swarm)
- active chain + contract address
- local agent keypair
- known epoch keys (local secure store)
- last processed event block

---

## 4) Data Objects (Offchain)

## 4.1 Encrypted Backup Bundle
State is organized as:
- **shared bundle** (swarm-common artifacts)
- **agent bundle(s)** (agent-specific soul/memory profiles)

Typical files in agent bundles:
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- selected memory/skill/config files

## 4.2 Manifest
- file list
- file hashes
- archive hash
- createdAt
- epoch
- encryption metadata

## 4.3 Wrapped Epoch Key Bundle
For each approved member in epoch E:
- `recipientAddress`
- `wrappedKey` (K_epoch encrypted to member public key)
- optional `wrapperAlgo`

Stored offchain (IPFS), referenced onchain by CID/hash.

---

## 5) Epoch Key Rotation (Rekey)

Use **epoch group key** (`K_epoch`) not pairwise double ratchet.

Design choice: keep one swarm `K_epoch` for both shared and per-agent bundles to minimize MVP complexity.

### Trigger conditions
- join approved
- member removed
- manual security rotate

### Rekey flow
1. Controller generates fresh `K_epoch+1`.
2. Controller fetches active members for new epoch.
3. Wraps `K_epoch+1` for each active member pubkey.
4. Uploads wrapped-key bundle to IPFS.
5. Calls `rotateEpoch(newEpoch, keyBundleCid, keyBundleHash)`.
6. Contract emits `EpochRotated`.
7. Members fetch and unwrap their copy.

### Access effect
- Removed members cannot decrypt epoch+ content.
- Existing local copies of older plaintext remain (accepted limitation).

---

## 6) Join Lifecycle

## 6.1 First Join (root trust)
1. Agent submits `requestJoin(pubkeyRef, metadataCid)`.
2. Owner approves first request.
3. Contract activates agent and emits `JoinApproved`.
4. Rekey to establish shared operational epoch.

## 6.2 Subsequent Joins (MVP)
- Owner approval path only.

## 6.3 Future Quorum
- M-of-N approvals (onchain votes or EIP-712 admission tickets).

---

## 7) Message Bus Protocol (Verified Events)

## 7.1 Design
- Onchain: message metadata only
- Offchain: encrypted payload

## 7.2 Contract method
`postMessage(to, topic, seq, epoch, payloadCid, payloadHash, ttl)`

Checks:
- sender active member
- swarm not paused
- `seq` > last sender seq
- epoch valid (typically current epoch)

Event:
`AgentMessagePosted(from, to, topic, seq, epoch, payloadCid, payloadHash, ttl, timestamp)`

## 7.3 Payload encryption
- Encrypt payload under current `K_epoch` (or per-recipient wrapped key for direct message mode)
- Include metadata in AAD: from/to/topic/seq/epoch

---

## 8) Backup / Restore Protocol

## 8.1 Backup
1. Build deterministic archive.
2. Compute hashes + manifest.
3. Encrypt archive with `K_epoch` (or derived backup key anchored to epoch key).
4. Upload ciphertext + manifest to IPFS.
5. Call `setLatestBackupPointer(epoch, bundleCid, manifestCid, manifestHash)`.

## 8.2 Restore
1. Confirm caller is active member.
2. Read latest pointer + current epoch.
3. Pull wrapped key bundle and unwrap `K_epoch` locally.
4. Fetch encrypted backup and manifest.
5. Decrypt and verify hashes.
6. Write files and start OpenClaw.

---

## 9) Bootstrap Strategy (MVP)

Recommended: bootstrap script distributed with CLI release (not IPFS).

Flow:
1. Install dependencies + SoulVault CLI.
2. Configure swarm contract context.
3. Generate local agent keypair.
4. Request join.
5. Wait for approval event.
6. Perform restore.

Security:
- distribute bootstrap with checksum/signature
- avoid dynamic remote script execution unless hash-pinned

---

## 10) Key Loss / VPS Nuke Recovery

## Problem scenario
A member VPS is fully lost and its local private key is unrecoverable. That node can no longer unwrap prior wrapped epoch keys.

## Design rule
The smart contract does **not** regenerate historical symmetric keys. It only governs authorized recovery/rekey operations and records references.

## MVP recovery path (Owner Escrow)
- For each epoch, keep an owner-escrow copy of key material (wrapped to owner key).
- Recovery flow:
  1. New VPS generates a fresh agent keypair.
  2. Owner/quorum approves key update/re-join.
  3. Owner unwraps escrowed key material and re-wraps for new agent key (or rotates to new epoch).
  4. Publish updated wrapped-key bundle CID/hash.
  5. New VPS restores from latest encrypted state.

## Quorum escrow path (Post-MVP)
- Protect against owner key loss by splitting recovery authority:
  - threshold shares (e.g., Shamir) among trusted operators/members
  - or equivalent threshold-controlled key service
- Recovery requires M-of-N authorized participants to reconstruct/authorize re-wrap.

## Ledger wallet note
- Hardware wallets (e.g., Ledger) are recommended for owner escrow keys.
- If owner escrow key is on Ledger and the device/recovery phrase is safe, recovery can be performed without exposing keys in software.

---

## 11) SSH / Tunnel Revalidation Model (Future-safe)

Do **not** reuse `K_epoch` as tunnel transport key directly.
Use membership/epoch events as auth signals for issuing short-lived access credentials:
- SSH certs
- WireGuard peer entries
- API tokens

On epoch rotate/kick:
- credentials expire/revoke
- nodes revalidate via latest membership + epoch

---

## 12) Chainlink Integration (MVP+)

Best immediate fit: **Automation**
- trigger `checkpointNeeded` checks
- trigger rotate reminder on pending membership changes
- trigger stale-backup alerts

What Chainlink does not do:
- hold private decrypt keys
- directly decrypt payloads

CCIP note:
- cross-chain messaging only needed if swarm spans chains
- out of MVP scope

---

## 12) Minimal Event Schema

- `JoinRequested(requestId, requester, pubkeyRef, metadataCid)`
- `JoinApproved(requestId, requester, approver, epoch)`
- `MemberRemoved(member, by, epoch)`
- `EpochRotated(oldEpoch, newEpoch, keyBundleCid, keyBundleHash)`
- `BackupPointerUpdated(epoch, bundleCid, manifestCid, manifestHash, by)`
- `AgentMessagePosted(from, to, topic, seq, epoch, payloadCid, payloadHash, ttl)`
- `Paused(by)` / `Unpaused(by)`

---

## 13) Agent Environment Manifests (Roadmap)

Agents may publish signed environment manifests (CPU/GPU/RAM/tooling/availability) to support future task delegation.

Recommended flow:
1. Agent signs manifest hash.
2. Manifest uploaded to IPFS.
3. Contract stores CID/hash pointer via `AgentManifestUpdated` event.

MVP note:
- Manifest support is included in MVP as **registration metadata** (publish/update pointer + event).
- Manifests remain informational in MVP (do not gate join/restore yet).

---

## 14) MVP Boundaries

Must-have:
- owner-gated joins
- epoch rotation on join/kick/manual
- encrypted backup/restore
- event-driven messaging metadata + encrypted payload refs
- CLI watcher + multi-swarm context

Can defer:
- quorum voting
- treasury automation
- cross-chain (CCIP)
- advanced tunnel orchestration
