# SoulVault

Encrypted continuity and coordination for agent swarms.

SoulVault gives autonomous agent swarms membership governance, encrypted backup/restore, epoch-key rotation, and a three-mode messaging bus — all driven by onchain contract events with encrypted offchain storage.

## Why

Agent sessions are ephemeral. Shared state is ad hoc. Backups are uncoordinated. Identity and permissions are fuzzy. Multi-agent systems need shared encrypted state and verifiable coordination.

SoulVault is that layer.

## Architecture

SoulVault operates across two EVM lanes:

| Lane | Chain | Purpose |
|------|-------|---------|
| **Ops** | 0G Galileo (16602) | Swarm contract, membership, epochs, backups, messaging |
| **Identity** | Sepolia (11155111) | ENS naming, ERC-8004 agent identity |

The swarm contract on 0G holds the coordination truth. 0G Storage holds encrypted artifacts (backups, key bundles, message envelopes). ENS + ERC-8004 on Sepolia provide public naming and discovery without being the source of truth for membership.

Visibility posture shorthand:
- `public` = swarm name + public-safe metadata can be published through ENS
- `private` = no direct ENS publication required for the swarm
- `semi-private` = organization/root ENS may be public while the swarm itself remains undiscoverable or only locally known

### Entity model

```
Organization  (ENS root, admin boundary)
  └── Swarm   (one contract, one member set, one epoch-key lineage)
       └── Agent  (wallet + runtime + optional public identity)
```

- `acme.eth` — organization
- `ops.acme.eth` — swarm
- `rusty.ops.acme.eth` — agent (optional)

### Signer model

| Role | Purpose | Recommended backend |
|------|---------|-------------------|
| **Admin** | ENS registration, join approvals, epoch rotation | Ledger (shipped) |
| **Agent** | Backups, message posting, join requests | Hot key |

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in keys and RPC endpoints
alias soulvault="pnpm exec tsx cli/src/index.ts"
```

Run through the [stories](stories/) for guided walkthroughs, starting with [story00](stories/story00.md) (bootstrap).

## CLI commands

The CLI follows an entity-first model:

### Status
| Command | Description |
|---------|-------------|
| `status` | Unified dashboard: wallet, agent, org, swarm, on-chain, keys, backup, env |
| `status --json` | Machine-readable JSON output |
| `status --offline` | Skip RPC calls, local state only |

### Organization
| Command | Description |
|---------|-------------|
| `organization create` | Create local org profile |
| `organization list` | List org profiles |
| `organization use <name>` | Set active org |
| `organization status` | Show active org |
| `organization register-ens` | Register ENS root on Sepolia |

### Swarm
| Command | Description |
|---------|-------------|
| `swarm create` | Deploy contract on 0G + bind ENS subdomain |
| `swarm list / use / status` | Profile management |
| `swarm join-request` | Agent submits join request |
| `swarm approve-join --request-id <id>` | Owner approves join |
| `swarm member-identities` | List members + ERC-8004 identities |
| `swarm backup-request` | Owner triggers coordinated backup |
| `swarm events list / watch` | Query or poll contract events |

### Agent
| Command | Description |
|---------|-------------|
| `agent create / status` | Local agent profile |
| `agent register / update / show` | ERC-8004 identity on Sepolia |

### Epoch
| Command | Description |
|---------|-------------|
| `epoch rotate` | Generate K_epoch, wrap per member, upload bundle, call contract |
| `epoch show-bundle` | Fetch + display latest bundle from 0G |
| `epoch decrypt-bundle-member` | Verify current member can decrypt |

### Backup & Restore
| Command | Description |
|---------|-------------|
| `backup push` | Archive, encrypt with K_epoch, upload to 0G, publish file mapping |
| `restore pull` | Decrypt backup |
| `restore verify-latest` | Download + decrypt + verify hashes |

### Messaging
| Command | Description |
|---------|-------------|
| `msg post` | Post message (public / group / dm) |
| `msg list` | List all messages from contract events |
| `msg show --payload-ref <hash>` | Fetch + optionally decrypt from 0G |

### Sync
| Command | Description |
|---------|-------------|
| `sync` | Bootstrap org/swarm profiles from ENS on any new machine |

Full command reference: [`skills/soulvault/references/commands.md`](skills/soulvault/references/commands.md)

## Encryption model

Each swarm epoch has one shared symmetric key (`K_epoch`). When membership changes, the owner rotates the epoch — generating a new key, wrapping it per member's secp256k1 pubkey, and uploading the bundle to 0G. Only the wrapped bundle reference and hash go onchain; symmetric keys never touch the chain.

| What | How |
|------|-----|
| Backups | AES-256-GCM with K_epoch |
| Group messages | AES-256-GCM with K_epoch |
| Direct messages | Ephemeral ECDH + AES-256-GCM to recipient pubkey |
| Key wrapping | secp256k1-ECDH + AES-256-GCM per member |

Details: [`skills/soulvault/references/crypto.md`](skills/soulvault/references/crypto.md)

## Messaging

Three modes through one contract primitive (`postMessage`):

| Mode | Encryption | Audience |
|------|-----------|----------|
| **public** | None | Anyone |
| **group** | K_epoch | All swarm members |
| **dm** | Recipient pubkey ECDH | Single recipient |

Spec: [`contracts/MESSAGE_PROTOCOL.md`](contracts/MESSAGE_PROTOCOL.md)

## Event-driven coordination

The swarm contract emits events that drive the protocol:

| Event | Trigger |
|-------|---------|
| `JoinRequested` / `JoinApproved` | Membership lifecycle |
| `EpochRotated` | Key rotation |
| `BackupRequested` | Coordinated backup trigger |
| `MemberFileMappingUpdated` | Backup publication proof |
| `AgentMessagePosted` | Messaging |
| `HistoricalKeyBundleGranted` | Key recovery for new/restored members |

Agents watch events and respond automatically — backup on `BackupRequested`, key unwrap on `EpochRotated`, etc.

Full catalog: [`skills/soulvault/references/events.md`](skills/soulvault/references/events.md)

## Stories

The [`stories/`](stories/) directory contains runnable, copy-paste walkthroughs:

| Story | Covers |
|-------|--------|
| [story00](stories/story00.md) | Bootstrap org + swarm + join/approve |
| [story01](stories/story01.md) | Browse orgs, swarms, member identities |
| [story03](stories/story03.md) | Epoch rotation + verification |
| [story04](stories/story04.md) | Event-driven backup coordination |
| [story05](stories/story05.md) | Messaging protocol (detailed) |
| [story06](stories/story06.md) | Messaging quick-start (3 examples) |
| [story07](stories/story07.md) | Ledger signer: local vs on-chain signing |

## Repo layout

```
contracts/          Solidity interfaces + specs + protocol docs
cli/src/
  commands/         Thin Commander.js handlers (one per entity)
  lib/              Business logic (crypto, contract, storage, state)
  index.ts          CLI entry point
docs/               Architecture, protocol, glossary, roadmap
stories/            Runnable demo walkthroughs
skills/soulvault/   Agent skill package (SKILL.md + references)
examples/           Standalone 0G SDK usage examples
slides/             Deck outline and presentation notes
```

## Key specs

- [`contracts/ISoulVaultSwarm.sol`](contracts/ISoulVaultSwarm.sol) — swarm contract interface
- [`contracts/IERC8004AgentRegistryAdapter.sol`](contracts/IERC8004AgentRegistryAdapter.sol) — identity adapter
- [`contracts/SWARM_CONTRACT_SPEC.md`](contracts/SWARM_CONTRACT_SPEC.md) — contract specification
- [`contracts/MESSAGE_PROTOCOL.md`](contracts/MESSAGE_PROTOCOL.md) — messaging protocol
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/protocol-v0.1.md`](docs/protocol-v0.1.md) — protocol specification
- [`docs/glossary.md`](docs/glossary.md) — terminology

## Agent skill

A repo-local skill package at [`skills/soulvault/`](skills/soulvault/) teaches agents how to use SoulVault:

- [`SKILL.md`](skills/soulvault/SKILL.md) — main skill documentation
- [`references/commands.md`](skills/soulvault/references/commands.md) — full CLI reference
- [`references/events.md`](skills/soulvault/references/events.md) — contract event catalog
- [`references/crypto.md`](skills/soulvault/references/crypto.md) — cryptographic model
- [`references/env.md`](skills/soulvault/references/env.md) — environment variables
- [`references/workflows.md`](skills/soulvault/references/workflows.md) — end-to-end workflows
- [`references/contract.md`](skills/soulvault/references/contract.md) — contract reference

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Status

SoulVault is under active development. The CLI, swarm contract, messaging, backup/restore, epoch rotation, Ledger signing, and ENS/ERC-8004 identity flows are implemented and tested on 0G Galileo + Sepolia.
