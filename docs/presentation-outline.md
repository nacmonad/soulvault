# Presentation / Deck Outline (Hackathon)

## Slide 1 — Title
**SoulVault: Encrypted Agent Continuity + Onchain Swarm Coordination**

## Slide 2 — Problem
- Agent memory/persona state is fragile across infra resets
- Trustless collaboration between multiple autonomous agents is hard
- Need secure restore + auditable coordination

## Slide 3 — Core Insight
- Keep state encrypted end-to-end
- Store ciphertext in 0G Storage
- Use swarm contracts as approval/coordination layer

## Slide 4 — Architecture
(visual)
Owner Wallet ↔ Swarm Contract ↔ SoulVault CLI ↔ 0G Storage ↔ OpenClaw Nodes

## Slide 5 — Security Model
- Human root-of-trust for first join
- Epoch content key model (`K_epoch`) with rotation on join/kick
- Wrapped key bundles in offchain encrypted storage (no symmetric keys onchain)
- Explicit per-member file mappings onchain (storage locator + merkle root + publish tx hash)
- Encrypted markdown bundles (`SOUL`, `MEMORY`, `HEARTBEAT`)
- No private keys in backups
- Hash verification at restore

## Slide 6 — Demo Flow
1. Deploy swarm contract
2. Agent requests join
3. Owner approves
4. Agent restores encrypted state from 0G Storage
5. Agent boots with recovered identity

## Slide 7 — Multi-Swarm + Event Watcher
- One contract = one swarm
- SoulVault can manage/switch many swarms
- Event-driven coordination

## Slide 8 — Quorum + Treasury Roadmap
- M-of-N admissions
- Safe-based USDC treasury policies
- Controlled auto-scale for new VPS agents

## Slide 9 — Competitive Landscape
**What exists:**
- Agent coordination frameworks
- DAO/multisig governance
- decentralized storage + encrypted backup tools

**What’s missing:**
- End-to-end agent identity continuity for markdown memory/state
- Join governance + encrypted restore in one lifecycle
- OpenClaw-native multi-swarm operations

**SoulVault contribution:**
- Encrypted continuity + onchain admissions + event-driven swarm messaging

## Slide 10 — Why this matters
- Agent continuity
- Composable coordination primitive
- Verified swarm messaging via contract events
- Useful for autonomous research/dev swarms

## Slide 11 — Ask / Next Steps
- Partner integrations
- Security review
- Production hardening
