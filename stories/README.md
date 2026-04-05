# SoulVault Stories

This directory contains short narrative/demo flows for the SoulVault CLI.

Each story is meant to be:
- easy to run manually
- useful in demos
- grounded in the actual command model
- focused on a single coherent operator journey

Current stories:
- `story00.md` — bootstrap organization + swarm + join/approve flow
- `story01.md` — browse organizations, swarms, and member identities
- `story02.md` — create a local agent profile and register ERC-8004 on-chain identity
- `story03.md` — rotate a swarm epoch bundle and verify the member entry
- `story04.md` — owner requests backup, agent watches event, agent uploads to 0G and publishes mapping
- `story05.md` — swarm messaging protocol (public, group, DM) with envelope formats and verification
- `story06.md` — messaging quick-start: three copy-paste examples (public broadcast, group coordination, encrypted DM)
- `story07.md` — Ledger signer: local `organization create` / `sync` vs on-chain signing; `SOULVAULT_LEDGER_CONFIRM_ADDRESS`
