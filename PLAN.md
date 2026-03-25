# SoulVault PLAN.md (Execution Guide)

This is the working build guide for implementation during hackathon.

## Scope Policy
- **MVP first.** No optional features until MVP acceptance checklist passes.
- WireGuard/relay, 0G, and advanced quorum are **post-MVP**.

---

## A) Critical Milestones (MVP Path)

## M1 — Contract Core + Registration Metadata (Day 1)
**Goal:** Swarm governance + event backbone exists.

Tasks:
- Implement swarm contract with:
  - owner + pause
  - join request + owner approval (`requestJoin(pubkey, pubkeyRef, metadataCid)` — pubkey stored in calldata and member record)
  - member active state
  - `currentEpoch`
  - `membershipVersion` counter (increments on every join approval or member removal)
  - backup pointer update method
  - message metadata event path
  - agent manifest pointer update path (CID/hash)
  - `grantHistoricalKeys(member, bundleCid, bundleHash, fromEpoch, toEpoch)` method
- Emit canonical events:
  - `JoinRequested(requestId, requester, pubkey, pubkeyRef, metadataCid)`
  - `JoinApproved`, `MemberRemoved`
  - `EpochRotated(oldEpoch, newEpoch, keyBundleCid, keyBundleHash, membershipVersion)`
  - `BackupPointerUpdated`
  - `AgentMessagePosted`
  - `AgentManifestUpdated`
  - `HistoricalKeyBundleGranted(member, bundleCid, bundleHash, fromEpoch, toEpoch)`

Exit criteria:
- Foundry tests pass for join/approve/remove/event emission.
- `membershipVersion` increments correctly on join and kick.
- `pubkey` is stored in member record and accessible from contract state.
- Manifest pointer update test passes for approved members.

---

## M2 — Epoch Key + Wrapped Bundle (Day 1)
**Goal:** Finalized key lifecycle implemented offchain.

Tasks:
- Implement `K_epoch` generation/rotation logic in CLI service layer
- Fetch active member pubkeys from contract state (no IPFS dependency)
- Wrap `K_epoch` per active member pubkey using X25519/libsodium box
- Include `ownerEscrowEntry` in every wrapped-key bundle (K_epoch wrapped to owner key)
- Publish wrapped-key bundle to IPFS
- Call `rotateEpoch(newEpoch, keyBundleCid, keyBundleHash, expectedMembershipVersion)` onchain (reverts if membershipVersion changed)
- Member unwrap path implemented and tested
- Implement `keygrant` flow: owner re-wraps historical epoch keys via ownerEscrowEntry for new/recovered member; uploads Historical Key Bundle; calls `grantHistoricalKeys`
- Configure IPFS pinning provider; implement `soulvault ipfs pin-all`

Exit criteria:
- On join/kick, old member cannot decrypt new epoch test payload.
- `rotateEpoch` reverts when membershipVersion does not match (concurrency control test).
- New joiner can decrypt historical backup after receiving Historical Key Bundle.

---

## M3 — Encrypted Backup/Restore (Day 1–2)
**Goal:** End-to-end encrypted continuity works.

Tasks:
- Build deterministic archive builder
- Hash + manifest generation
- Encrypt backup bundle(s) with `K_epoch`
- Support two bundle classes:
  - shared swarm state
  - per-agent state bundle
- Upload encrypted bundle + manifest to IPFS
- Update backup pointer(s) onchain (single swarm `latestBackupPointer` **or** per-member `memberBackupPointers` — see `docs/protocol-v0.1.md` §3 / §8; parallel agents usually want per-member heads)
- Restore flow:
  - fetch pointers + wrapped bundle
  - unwrap `K_epoch`
  - select restore target (shared vs specific agent)
  - decrypt + verify + write files

Exit criteria:
- Fresh node restore succeeds and integrity checks pass.
- CLI can restore a specific agent soul/memory bundle by selection.

---

## M4 — CLI + Event Watcher + Multi-Swarm (Day 2)
**Goal:** Operator flow is usable.

Tasks:
- CLI commands:
  - `swarm create/list/use`
  - `join request/approve`
  - `epoch rotate` (owner triggers rekey with membershipVersion check)
  - `keygrant --member <addr> --from-epoch <N>` (historical key grant)
  - `agent manifest publish/update`
  - `backup push`
  - `restore pull`
  - `events watch`
  - `ipfs pin-all` (pin all contract-referenced CIDs)
- Local swarm profile store
- Event watcher resumes from last processed block
- CLI prompts owner to run `epoch rotate` after `JoinApproved` or `MemberRemoved` events

Exit criteria:
- Can run full demo from CLI without manual RPC gymnastics.
- Agent manifest can be published at/after join and resolved by CID.
- `ipfs pin-all` successfully pins all CIDs from contract event history.

---

## M5 — OpenClaw Skill Wrapper (Day 2)
**Goal:** Agent-native integration is demonstrable.

Tasks:
- Add `skills/soulvault/` wrapper docs + command mapping
- Expose common workflows for join/backup/restore/keygrant/epoch rotate/status

Exit criteria:
- Triggering core SoulVault flows through OpenClaw skill commands works.
- `keygrant` and `epoch rotate` accessible via skill wrapper.

---

## M6 — Demo Hardening + Submission Assets (Final)
**Goal:** Repeatable judging demo.

Tasks:
- Dry-run demo twice from clean environment
- Lock submission text, architecture slide, 90s pitch
- Record known limitations and roadmap items

Exit criteria:
- 2-minute live demo passes with no protocol ambiguity.

---

## B) Optional Milestones (Only After MVP)

## O1 — Chainlink Automation Expansion (Judge-impact first)
- Auto-trigger checkpoint/revalidation tasks
- Rotate reminders + stale backup alerts
- Optional keeper for "checkpoint needed" heartbeat visibility

## O2 — WireGuard/Relay Layer
- Use swarm membership + epoch events to refresh network credentials
- Add outbound-only connectivity pathway through optional relay
- Keep transport keys separate from `K_epoch`

## O3 — Quorum Join Governance
- Replace owner-only approvals with M-of-N admissions
- EIP-712 admission tickets or onchain vote proposals

## O4 — Quorum Escrow Recovery
- Add threshold recovery path so owner-key loss is survivable
- Define M-of-N escrow participants and reconstruction/authorization policy
- Integrate escrow recovery into node key-loss runbook

## O5 — 0G/Flare Integrations
- 0G for larger non-critical artifact/data path
- Flare for attestation/data-driven policy hooks

## O6 — Treasury + Scale-Out
- Safe-based USDC treasury policy prototype
- Controlled scale-out proposal flow
- IPFS pinning SaaS funded by swarm treasury

---

## C) Out-of-Scope for MVP (Explicit)
- Full autonomous purchasing/deployment of VPS
- Cross-chain coordination (CCIP)
- Full mesh network orchestration
- Production-grade relay SLA platform

---

## D) MVP Acceptance Checklist
- [ ] Owner deploys contract
- [ ] Agent submits join request (`pubkey` in calldata, stored in contract member record)
- [ ] Owner approves first agent (`membershipVersion` increments)
- [ ] Agent manifest pointer can be published/updated (`AgentManifestUpdated`)
- [ ] Epoch key exists and rotates on membership change (`rotateEpoch` validates `membershipVersion`)
- [ ] Wrapped key bundle published on IPFS with `ownerEscrowEntry`
- [ ] Agent unwraps key and decrypts backup
- [ ] Backup pointer updated onchain
- [ ] Owner issues historical key grant; new/recovered member decrypts past backup (`HistoricalKeyBundleGranted`)
- [ ] `soulvault ipfs pin-all` pins all contract-referenced CIDs
- [ ] Event watcher shows verified lifecycle (including manifest + keygrant events)
- [ ] OpenClaw skill wrapper demonstrates core flow (including keygrant + epoch rotate)

---

## E) Execution Notes
- Prefer one stable testnet (Base Sepolia default)
- Keep contracts minimal and test-heavy
- Keep message payloads encrypted offchain, metadata onchain
- Do not expand into optional layers until MVP is green
