# SoulVault Deliverables Checklist

## 1) MVP Deliverables (must-have)
- [ ] Swarm contract deployed on testnet
- [ ] First-agent join requires owner approval
- [ ] `pubkey` stored in join request calldata and member record (no IPFS dependency for pubkey resolution)
- [ ] `membershipVersion` counter increments on every join/kick
- [ ] Epoch key rotation model implemented (`K_epoch`)
- [ ] Wrapped key bundles published to IPFS per epoch (no symmetric keys onchain)
- [ ] Every wrapped-key bundle includes `ownerEscrowEntry`
- [ ] `rotateEpoch` validates `expectedMembershipVersion` (concurrency control)
- [ ] Historical Key Grant implemented:
  - [ ] `soulvault keygrant --member <addr> --from-epoch <N>` CLI command
  - [ ] `grantHistoricalKeys` contract method
  - [ ] `HistoricalKeyBundleGranted` event emitted and watched
  - [ ] New member CLI unwraps and stores historical epoch keys
- [ ] SoulVault CLI supports:
  - [ ] `swarm create/list/use`
  - [ ] `join request/approve`
  - [ ] `epoch rotate`
  - [ ] `keygrant`
  - [ ] `backup push`
  - [ ] `restore pull`
  - [ ] `events watch`
  - [ ] `ipfs pin-all`
- [ ] Markdown state encrypted before IPFS upload
- [ ] Restore verifies embedded manifest + per-file hashes against on-chain `manifestHash`
- [ ] Demo shows restore to fresh node/VPS
- [ ] Owner pins all CIDs via configured provider (local node or Pinata/Web3Storage)

## 2) OpenClaw Integration Deliverable
- [ ] `skills/soulvault/` skill exists
- [ ] Skill wraps CLI for common ops (join/backup/restore/keygrant/rotate/status)
- [ ] Skill docs include examples and safety notes
- [ ] Agent can trigger backup/join/restore/keygrant via skill commands

## 3) Messaging + Coordination Deliverable
- [ ] Contract emits verified messaging events (`AgentMessagePosted`)
- [ ] Message payload stored encrypted offchain (IPFS)
- [ ] Event includes reference metadata only (CID/hash/topic/seq/epoch)
- [ ] `epoch` equality check enforced in `postMessage`

## 4) Security Deliverable
- [ ] No plaintext memory/persona markdowns on IPFS
- [ ] No private keys in repo or backup bundle
- [ ] Join gating enforced onchain; pubkey in calldata
- [ ] Restore requires approval + decrypt capability
- [ ] Owner escrow recovery path (`ownerEscrowEntry`) documented and testable
- [ ] Historical Key Grant flow documented and testable
- [ ] `.gitignore` prevents committing sensitive local state

## 5) Demo Acceptance Checklist (live)
- [ ] Deploy contract
- [ ] Agent A requests join (pubkey in calldata)
- [ ] Owner approves join and triggers `epoch rotate`
- [ ] Backup encrypted markdown bundle to IPFS
- [ ] Fresh node restores from latest CID
- [ ] Agent starts with restored identity/memory
- [ ] Owner issues historical key grant; new joiner decrypts past backup
- [ ] Show contract events proving join + backup + message + keygrant flow

## 6) Stretch Goals (only if time remains)
- [ ] Chainlink Automation triggers `RekeyRequested`
- [ ] Quorum approvals (M-of-N)
- [ ] Multi-swarm switching UX polish
- [ ] Safe/USDC treasury policy demo
- [ ] Task-proposal event model (autoresearch-style)

## 7) Scope-Cut Order (if behind schedule)
Cut in this order:
1. Treasury automation
2. Full quorum voting
3. Chainlink automation
4. Task proposal layer
5. UI polish

Keep at all costs:
- owner-gated join with pubkey in calldata
- encrypted backup/restore
- epoch rotation with `membershipVersion` concurrency control
- owner escrow entry in every wrapped-key bundle
- historical key grant (critical for the "new joiner sees full history" demo story)
- contract event audit trail
- OpenClaw skill wrapper
