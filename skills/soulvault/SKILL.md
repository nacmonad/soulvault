---
name: soulvault
description: Operate SoulVault swarms and agent identities. Use when working with the SoulVault CLI, swarm membership, epoch rotation, backup/restore, historical key grants, 0G-backed encrypted state publication, ERC-8004 agent identity registration, or when an agent needs to watch/respond to SoulVault swarm contract events such as JoinApproved, EpochRotated, BackupRequested, MemberFileMappingUpdated, HistoricalKeyBundleGranted, or AgentMessagePosted.
---

# SoulVault

SoulVault is an event-driven coordination and continuity layer for agent swarms. It combines an onchain swarm contract (0G Galileo) for membership, epochs, and coordination events with encrypted 0G Storage for backups/keys, ERC-8004 for optional public agent identity, and ENS for optional naming/discovery.

## Architecture — Two EVM Lanes

| Lane | Chain | Purpose |
|------|-------|---------|
| SoulVault (ops) | 0G Galileo (chain ID `16602`) | Swarm contract, joins, epochs, backups, file mappings, messages |
| ETH/ENS (identity) | Sepolia (chain ID `11155111`) | ENS naming, ERC-8004 agent identity registration |

## Entity Hierarchy

```
Organization (public namespace, optional ENS root)
└── Swarm (one SoulVault contract on 0G, independent K_epoch lineage)
    └── Agent (local wallet, may join multiple swarms, optional ERC-8004 identity)
```

## Core Workflow

1. **Bootstrap** — Create organization → register ENS → deploy swarm contract → bind ENS subdomain
2. **Join** — Agent submits join request with pubkey → owner approves → member activated
3. **Epoch Rotate** — Owner generates K_epoch, wraps per member pubkey, uploads bundle to 0G, calls `rotateEpoch` on contract
4. **Backup** — Owner emits `BackupRequested` → agent watcher detects event → runs backup/encrypt/upload → publishes file mapping onchain
5. **Restore** — Fetch encrypted backup from 0G → unwrap K_epoch from bundle �� decrypt locally → verify hashes
6. **Message** — Post messages via `msg post` (public/group/dm) → upload envelope to 0G → call `postMessage` onchain with 0G hash as `payloadRef`
7. **Identity** — Optionally register ERC-8004 agent identity on Sepolia with services and swarm metadata

## Command Reference

See `references/commands.md` for the full CLI surface with every flag and option.

## Event Reference

See `references/events.md` for all contract events and agent response behavior.

## Cryptographic Model

See `references/crypto.md` for encryption algorithms, key wrapping, and the epoch key lifecycle.

## Workflow Examples

See `references/workflows.md` for end-to-end executable stories.

## Rules

- The swarm contract is the authority for membership, epoch, file mapping, and trigger events.
- ERC-8004 is the authority for public agent identity metadata (optional, does not block joins or backups).
- ENS is the optional public naming/discovery layer (not source of truth for membership or epoch access).
- Prefer event-driven backup via `BackupRequested` over cron/heartbeat. Use scheduled backup only as fallback.
- All backups are encrypted with K_epoch (AES-256-GCM). No plaintext leaves the local machine.
- All epoch keys are wrapped per member pubkey (secp256k1-ECDH + AES-256-GCM). No symmetric keys are stored onchain.
- Encrypted messages under K_epoch are swarm-readable (shared key model), not recipient-private.
- `rotateEpoch` requires `expectedMembershipVersion` — always fetch current version before rotating.
- Do not invent contract methods or CLI subcommands beyond the specs in this repo.
- Use `swarm backup-request` to coordinate swarm-wide backup waves (owner emits event).
- Use `backup push` for the agent-side backup flow (archive → encrypt → upload → file mapping).
- Use `msg post --mode public|group|dm` for messaging. Public is plaintext, group encrypts with K_epoch, dm encrypts to recipient's pubkey.
- Use `agent register` / `agent update` for ERC-8004 operations (preferred over legacy `identity` commands).
- The `identity` command group is a legacy alias — `agent` commands are preferred and include swarm context resolution.

## Local State

```
~/.soulvault/
  config.json              — active org/swarm pointers
  agent.json               — local agent profile (name, address, pubkey, harness, backup command)
  last-backup.json         — manifest for restore verification
  organizations/
    <slug>.json            — org profiles
  swarms/
    <slug>.json            — swarm profiles (contract address, chain ID, ENS, etc.)
  keys/
    <swarm-slug>/
      epoch-<n>.json       — stored epoch keys (keyHex, fingerprint, source, createdAt)
```

## Environment Variables

See `references/env.md` for the full `.env` configuration reference.
