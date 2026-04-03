---
name: soulvault
description: Operate SoulVault swarms and agent identities. Use when working with the SoulVault CLI, swarm membership, epoch rotation, backup/restore, historical key grants, 0G-backed encrypted state publication, ERC-8004 agent identity registration, or when an agent needs to watch/respond to SoulVault swarm contract events such as JoinApproved, EpochRotated, BackupRequested, MemberFileMappingUpdated, HistoricalKeyBundleGranted, or AgentMessagePosted.
---

# SoulVault

Use the SoulVault CLI as the primary control surface.

## Workflow
- For swarm operations, use the commands in `references/commands.md`.
- For event-driven behavior, read `references/events.md` and follow the watcher responsibilities.
- Prefer event-driven backup via `BackupRequested` over cron/heartbeat. Use scheduled backup only as fallback.
- Treat the swarm contract as the authority for membership, epoch, file mapping, and trigger events.
- Treat ERC-8004 as the authority for public agent identity metadata.

## Rules
- Do not invent contract methods or CLI subcommands beyond the specs in this repo.
- Use `backup request` to coordinate swarm-wide backup waves.
- Use `backup push` to actually perform local backup + encrypt + upload + file mapping publication.
- Use `identity create-agent` / `identity update` for ERC-8004 operations.
- When handling encrypted messages, assume payloads are swarm-readable under `K_epoch`, not recipient-private.

## References
- Read `references/commands.md` for command selection and command semantics.
- Read `references/events.md` when implementing or operating event listeners/watchers.
