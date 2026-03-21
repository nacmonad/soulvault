# Proof of Useful Work Roadmap (SoulVault Endgame)

## Why this exists
SoulVault MVP proves secure swarm continuity (identity/memory/coordination).
This roadmap extends SoulVault toward proving that agent work is not only performed, but **useful**.

---

## 1) Definition (for this project)
**Proof of Useful Work (PoUW)** = cryptographically anchored evidence that:
1. a swarm-approved agent performed a task,
2. produced a concrete artifact,
3. passed one or more verifiers/quality checks,
4. and was accepted by governance policy.

This is different from proof-of-compute/effort; it focuses on validated outcomes.

---

## 2) Architecture Fit with SoulVault

Existing SoulVault primitives already provide:
- identity/auth (approved swarm members)
- event log (verifiable history)
- encrypted offchain artifact storage (IPFS)
- governance hooks (owner/quorum)

PoUW adds:
- task definitions + acceptance criteria
- artifact/result commitments
- verifier outputs and acceptance events

---

## 3) Minimal Data Model

## TaskSpec (offchain, CID referenced)
- `taskId`
- `swarmId`
- `creator`
- `objective`
- `inputsCid[]`
- `constraints` (time, cost, tool boundaries)
- `evalSpecCid` (scoring rules)
- `deadline`

## WorkSubmission (offchain, CID referenced)
- `taskId`
- `workerAgent`
- `runConfigHash`
- `artifactCid`
- `artifactHash`
- `logsCid` (optional)
- `metrics` / summary

## VerificationReport (offchain, CID referenced)
- `taskId`
- `submissionId`
- `verifierType` (deterministic | benchmark | human/judge)
- `score`
- `pass/fail`
- `reason`
- `evidenceCid`

---

## 4) Suggested Onchain Events / Methods

### Methods
- `createTask(taskSpecCid, taskSpecHash)`
- `submitWork(taskId, submissionCid, submissionHash)`
- `submitVerification(taskId, submissionId, reportCid, reportHash, score, passed)`
- `acceptWork(taskId, submissionId)`
- `rejectWork(taskId, submissionId, reasonCode)`

### Events
- `TaskCreated(taskId, creator, taskSpecCid, taskSpecHash)`
- `WorkSubmitted(taskId, submissionId, worker, submissionCid, submissionHash)`
- `WorkVerified(taskId, submissionId, verifier, score, passed, reportCid, reportHash)`
- `WorkAccepted(taskId, submissionId, by)`
- `WorkRejected(taskId, submissionId, by, reasonCode)`

All heavy payloads remain offchain; chain stores commitments and decisions.

---

## 5) Verifier Types (Incremental)

## V0 (MVP-friendly)
- Deterministic checks only:
  - schema validity
  - required files present
  - reproducible command output hash

## V1
- Benchmark checks:
  - objective metrics above threshold
  - regression test gates

## V2
- Hybrid:
  - deterministic + benchmark + human quorum acceptance

---

## 6) Anti-Gaming Rules

- pre-commit evaluation specs before submissions
- fixed deadline windows
- immutable artifact hashes
- replay protection (`nonce`, unique submission IDs)
- optional staking/slashing for spammy or malicious submissions
- challenge window before final acceptance

---

## 7) Relationship to K_epoch / Security

PoUW does not replace SoulVault security model.

- sensitive artifacts may stay encrypted under current `K_epoch`
- verification can run on decrypted data in trusted contexts
- only commitments/metadata are emitted onchain
- membership changes still force epoch rekey for future confidentiality

---

## 8) Treasury / Incentives (Post-MVP)

When treasury layer is enabled:
- accepted submissions can trigger rewards (e.g., testnet USDC now, real later)
- policy can weight rewards by score/impact
- optional reputation index per agent/signer

This creates a path from “coordination” to “productive swarm economy.”

---

## 9) Delivery Phases

## Phase A (after core MVP)
- task + submission + verify + accept events
- deterministic verifier only

## Phase B
- benchmark verifier integration
- ranked accepted work

## Phase C
- reward payouts + reputation
- optional quorum-only acceptance mode

---

## 10) Hackathon Messaging

Short framing:
> SoulVault starts with secure swarm memory continuity, then evolves into a verifiable agent productivity layer where accepted work can be cryptographically tracked, governed, and eventually rewarded.

This keeps MVP realistic while showing a clear, credible endgame.
