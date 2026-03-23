# SoulVault Deliverables Checklist

## 1) MVP Deliverables (must-have)
- [ ] Swarm contract deployed on testnet
- [ ] First-agent join requires owner approval
- [ ] Epoch key rotation model implemented (`K_epoch`)
- [ ] Wrapped key bundles published to IPFS per epoch (no symmetric keys onchain)
- [ ] SoulVault CLI supports:
  - [ ] `swarm create/list/use`
  - [ ] `join request/approve`
  - [ ] `backup push`
  - [ ] `restore pull`
  - [ ] `events watch`
- [ ] Markdown state encrypted before IPFS upload
- [ ] Restore verifies manifest + file hashes
- [ ] Demo shows restore to fresh node/VPS

## 2) OpenClaw Integration Deliverable
- [ ] `skills/soulvault/` skill exists
- [ ] Skill wraps CLI for common ops
- [ ] Skill docs include examples and safety notes
- [ ] Agent can trigger backup/join/restore via skill commands

## 3) Messaging + Coordination Deliverable
- [ ] Contract emits verified messaging events (`AgentMessagePosted`)
- [ ] Message payload stored encrypted offchain (IPFS)
- [ ] Event includes reference metadata only (CID/hash/topic/nonce)

## 4) Security Deliverable
- [ ] No plaintext memory/persona markdowns on IPFS
- [ ] No private keys in repo or backup bundle
- [ ] Join gating enforced onchain
- [ ] Restore requires approval + decrypt capability
- [ ] Owner escrow recovery path documented and testable (MVP)
- [ ] `.gitignore` prevents committing sensitive local state

## 5) Demo Acceptance Checklist (live)
- [ ] Deploy contract
- [ ] Agent A requests join
- [ ] Owner approves join
- [ ] Backup encrypted markdown bundle to IPFS
- [ ] Fresh node restores from latest CID
- [ ] Agent starts with restored identity/memory
- [ ] Show contract events proving join + backup + message flow

## 6) Stretch Goals (only if time remains)
- [ ] Quorum approvals (M-of-N)
- [ ] Multi-swarm switching UX polish
- [ ] Safe/USDC treasury policy demo
- [ ] Task-proposal event model (autoresearch-style)

## 7) Scope-Cut Order (if behind schedule)
Cut in this order:
1. Treasury automation
2. Full quorum voting
3. Task proposal layer
4. UI polish

Keep at all costs:
- owner-gated join
- encrypted backup/restore
- contract event audit trail
- OpenClaw skill wrapper
