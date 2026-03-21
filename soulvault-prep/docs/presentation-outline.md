# Presentation / Deck Outline (Hackathon)

## Slide 1 — Title
**SoulVault: Encrypted Agent Continuity + Onchain Swarm Coordination**

## Slide 2 — Problem
- Agent memory/persona state is fragile across infra resets
- Trustless collaboration between multiple autonomous agents is hard
- Need secure restore + auditable coordination

## Slide 3 — Core Insight
- Keep state encrypted end-to-end
- Store ciphertext in IPFS
- Use swarm contracts as approval/coordination layer

## Slide 4 — Architecture
(visual)
Owner Wallet ↔ Swarm Contract ↔ SoulVault CLI ↔ IPFS ↔ OpenClaw Nodes

## Slide 5 — Security Model
- Human root-of-trust for first join
- Encrypted markdown bundles (`SOUL`, `MEMORY`, `HEARTBEAT`)
- No private keys in backups
- Hash verification at restore

## Slide 6 — Demo Flow
1. Deploy swarm contract
2. Agent requests join
3. Owner approves
4. Agent restores encrypted state from IPFS
5. Agent boots with recovered identity

## Slide 7 — Multi-Swarm + Event Watcher
- One contract = one swarm
- SoulVault can manage/switch many swarms
- Event-driven coordination

## Slide 8 — Quorum + Treasury Roadmap
- M-of-N admissions
- Safe-based USDC treasury policies
- Controlled auto-scale for new VPS agents

## Slide 9 — Why this matters
- Agent continuity
- Composable coordination primitive
- Useful for autonomous research/dev swarms

## Slide 10 — Ask / Next Steps
- Partner integrations
- Security review
- Production hardening
