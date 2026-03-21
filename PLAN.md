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
  - join request + owner approval
  - member active state
  - `currentEpoch`
  - backup pointer update method
  - message metadata event path
  - agent manifest pointer update path (CID/hash)
- Emit canonical events:
  - `JoinRequested`, `JoinApproved`, `MemberRemoved`
  - `EpochRotated`
  - `BackupPointerUpdated`
  - `AgentMessagePosted`
  - `AgentManifestUpdated`

Exit criteria:
- Foundry tests pass for join/approve/remove/event emission.
- Manifest pointer update test passes for approved members.

---

## M2 — Epoch Key + Wrapped Bundle (Day 1)
**Goal:** Finalized key lifecycle implemented offchain.

Tasks:
- Implement `K_epoch` generation/rotation logic in CLI service layer
- Wrap `K_epoch` per active member pubkey
- Publish wrapped-key bundle to IPFS
- Write `rotateEpoch(...keyBundleCid/hash...)` onchain
- Member unwrap path implemented and tested

Exit criteria:
- On join/kick, old member cannot decrypt new epoch test payload.

---

## M3 — Encrypted Backup/Restore (Day 1–2)
**Goal:** End-to-end encrypted continuity works.

Tasks:
- Build deterministic archive builder
- Hash + manifest generation
- Encrypt backup bundle with `K_epoch`
- Upload encrypted bundle + manifest to IPFS
- Update backup pointer onchain
- Restore flow:
  - fetch pointers + wrapped bundle
  - unwrap `K_epoch`
  - decrypt + verify + write files

Exit criteria:
- Fresh node restore succeeds and integrity checks pass.

---

## M4 — CLI + Event Watcher + Multi-Swarm (Day 2)
**Goal:** Operator flow is usable.

Tasks:
- CLI commands:
  - `swarm create/list/use`
  - `join request/approve`
  - `agent manifest publish/update`
  - `backup push`
  - `restore pull`
  - `events watch`
- Local swarm profile store
- Event watcher resumes from last processed block

Exit criteria:
- Can run full demo from CLI without manual RPC gymnastics.
- Agent manifest can be published at/after join and resolved by CID.

---

## M5 — OpenClaw Skill Wrapper (Day 2)
**Goal:** Agent-native integration is demonstrable.

Tasks:
- Add `skills/soulvault/` wrapper docs + command mapping
- Expose common workflows for join/backup/restore/status

Exit criteria:
- Triggering core SoulVault flows through OpenClaw skill commands works.

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

## O4 — 0G/Flare Integrations
- 0G for larger non-critical artifact/data path
- Flare for attestation/data-driven policy hooks

## O5 — Treasury + Scale-Out
- Safe-based USDC treasury policy prototype
- controlled scale-out proposal flow

---

## C) Out-of-Scope for MVP (Explicit)
- Full autonomous purchasing/deployment of VPS
- Cross-chain coordination (CCIP)
- Full mesh network orchestration
- Production-grade relay SLA platform

---

## D) MVP Acceptance Checklist
- [ ] Owner deploys contract
- [ ] Agent submits join request
- [ ] Owner approves first agent
- [ ] Epoch key exists and rotates on membership change
- [ ] Wrapped key bundle published on IPFS
- [ ] Agent unwraps key and decrypts backup
- [ ] Backup pointer updated onchain
- [ ] Event watcher shows verified lifecycle
- [ ] OpenClaw skill wrapper demonstrates core flow

---

## E) Execution Notes
- Prefer one stable testnet (Base Sepolia default)
- Keep contracts minimal and test-heavy
- Keep message payloads encrypted offchain, metadata onchain
- Do not expand into optional layers until MVP is green
