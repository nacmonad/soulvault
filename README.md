# SoulVault — Hackathon Prep (Pre-Event Docs)

> Prep-only docs and scaffolding. No implementation work started before event kickoff.

## Concept
SoulVault is a CLI + contract coordination system for encrypted OpenClaw state continuity:
- Encrypt agent memory/persona markdowns locally
- Store ciphertext on IPFS
- Use onchain swarm contracts for join approvals and coordination
- Restore onto new VPS nodes after approval + decryption

## Core Ideas Locked
1. Human owner deploys first swarm contract (root trust)
2. First agent join requires owner approval
3. Markdown state (`SOUL.md`, `MEMORY.md`, `HEARTBEAT.md`, etc.) is encrypted before IPFS upload
4. Epoch key model (`K_epoch`) secures content; symmetric keys are never onchain
5. On join/kick/manual rotate, SoulVault rekeys and publishes wrapped key bundles to IPFS
6. SoulVault CLI listens to contract events and orchestrates join/rekey/restore flow
7. One contract = one swarm
8. SoulVault can manage multiple swarms and switch active swarm context

## Planned CLI Surface
- `soulvault swarm create`
- `soulvault swarm list`
- `soulvault swarm use <id>`
- `soulvault join request`
- `soulvault join approve`
- `soulvault backup push`
- `soulvault restore pull`
- `soulvault events watch`

## Doc Index
- `docs/architecture.md`
- `docs/bootstrap-and-join.md`
- `docs/protocol-v0.1.md`
- `docs/quorum-roadmap.md`
- `docs/technologies.md`
- `docs/treasury-and-autonomy.md`
- `docs/deliverables-checklist.md`
- `docs/presentation-outline.md`
- `docs/pitch-90s.md`
- `docs/glossary.md`

## Event Kickoff TODO
- Initialize repo
- Add contract skeleton
- Add CLI skeleton
- Implement encrypted archive + IPFS adapter
- Implement event watcher + join state machine
