# SoulVault

Encrypted continuity and coordination for agent swarms.

SoulVault gives autonomous agent swarms membership governance, encrypted backup/restore, epoch-key rotation, a three-mode messaging bus, and a fund-request treasury — all driven by onchain contract events with encrypted offchain storage.

## Why

Agent sessions are ephemeral. Shared state is ad hoc. Backups are uncoordinated. Identity and permissions are fuzzy. Multi-agent systems need shared encrypted state and verifiable coordination.

SoulVault is that layer.

## Architecture

SoulVault operates across two EVM lanes:

| Lane | Chain | Purpose |
|------|-------|---------|
| **Ops** | 0G Galileo (16602) | Swarm contract, treasury contract, membership, epochs, backups, messaging, fund requests |
| **Identity** | Sepolia (11155111) | ENS naming (org roots, swarm subdomains, ENSIP-11 treasury discovery), ERC-8004 agent identity |

The swarm contract on 0G holds coordination truth. The treasury contract on 0G holds native value and releases funds on approved requests. 0G Storage holds encrypted artifacts (backups, key bundles, message envelopes). ENS + ERC-8004 on Sepolia provide public naming and discovery.

### Entity model

```
Organization  (ENS root, admin boundary, optional treasury per chain)
  ├── Treasury  (SoulVaultTreasury — one per chain, discovered via ENSIP-11 addr)
  └── Swarm     (SoulVaultSwarm — one contract, one member set, one epoch-key lineage)
       └── Agent  (wallet + runtime + optional public identity)
```

- `acme.eth` — organization
- `ops.acme.eth` — swarm
- `rusty.ops.acme.eth` — agent (optional)

### ENS conventions

| Record | Location | Purpose |
|--------|----------|---------|
| `addr(orgNode, coinType)` | Org ENS name | ENSIP-11 multichain treasury address (`coinType = 0x80000000 \| chainId`) |
| `class` text record | Org ENS name | `soulvault.organization` — signals this is a SoulVault org |
| `name` text record | Org ENS name | Human-readable org name |
| `soulvault.swarms` text record | Org ENS name | CBOR array of swarm labels (`data:application/cbor;base64,…`) |
| `soulvault.swarmContract` text record | Swarm subdomain | Swarm contract address on 0G |
| `soulvault.chainId` text record | Swarm subdomain | Chain ID where the swarm contract lives |

Treasury discovery uses ENSIP-11 rather than text records so an org with treasuries on multiple chains gets one slot per chain without clobbering. For 0G Galileo: `coinType = 2147500186`.

### Signer model

| Role | Purpose | Recommended backend |
|------|---------|-------------------|
| **Admin** | ENS registration, join approvals, epoch rotation, treasury operations | Ledger (shipped) |
| **Agent** | Backups, message posting, join requests, fund requests | Hot key |

Visibility posture shorthand:
- `public` = swarm name + public-safe metadata can be published through ENS
- `private` = no direct ENS publication required for the swarm
- `semi-private` = organization/root ENS may be public while the swarm itself remains undiscoverable

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
| `organization register-ens` | Register ENS root on Sepolia + write org metadata records (`class`, `name`) |
| `organization set-ens-name` | Attach a root `.eth` name to an existing profile |

### Treasury
| Command | Description |
|---------|-------------|
| `treasury create` | Deploy treasury on 0G + publish ENSIP-11 addr on org ENS name |
| `treasury list` | List all local treasury profiles |
| `treasury status` | Show treasury balance, owner, chainId |
| `treasury deposit --amount <n>` | Send native value into the treasury |
| `treasury withdraw --to <addr> --amount <n>` | Owner drains value |
| `treasury approve-fund --swarm <s> --request-id <id>` | Approve a pending fund request (releases funds) |
| `treasury reject-fund --swarm <s> --request-id <id> --reason <text>` | Reject a pending fund request |
| `treasury fund-requests list` | List fund requests across swarms |

### Swarm
| Command | Description |
|---------|-------------|
| `swarm create` | Deploy contract on 0G (auto-discovers treasury via ENSIP-11) + bind ENS subdomain |
| `swarm remove --swarm <s> --yes` | Archive profile + strip from org's ENS swarms list |
| `swarm list / use / status` | Profile management |
| `swarm join-request` | Agent submits join request |
| `swarm approve-join --request-id <id>` | Owner approves join |
| `swarm member-identities` | List members + ERC-8004 identities |
| `swarm set-treasury --treasury <addr>` | Bind/rebind treasury (with cross-chain validation) |
| `swarm treasury-status` | Show bound treasury |
| `swarm fund-request --amount <n> --reason <text>` | Agent files a fund request |
| `swarm cancel-fund-request --request-id <id>` | Agent cancels own pending request |
| `swarm fund-status --request-id <id>` | Check single fund request |
| `swarm fund-requests list` | List all fund requests on the swarm |
| `swarm backup-request` | Owner triggers coordinated backup |
| `swarm events list / watch` | Query or poll contract events (merges swarm + treasury) |

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

Two contracts emit events that drive the protocol:

### Swarm events
| Event | Trigger |
|-------|---------|
| `JoinRequested` / `JoinApproved` | Membership lifecycle |
| `EpochRotated` | Key rotation |
| `BackupRequested` | Coordinated backup trigger |
| `MemberFileMappingUpdated` | Backup publication proof |
| `AgentMessagePosted` | Messaging |
| `HistoricalKeyBundleGranted` | Key recovery for new/restored members |
| `TreasurySet` | Treasury binding (constructor or `setTreasury`) |
| `FundRequested` / `FundRequestApproved` / `FundRequestRejected` / `FundRequestCancelled` | Fund request lifecycle |

### Treasury events
| Event | Trigger |
|-------|---------|
| `FundsDeposited` | Deposit received |
| `FundsReleased` | Fund request approved + payout |
| `FundRequestRejectedByTreasury` | Fund request rejected |
| `TreasuryWithdrawn` | Owner withdrawal |

When a swarm has a bound treasury, `swarm events watch` merges events from both contracts into a single stream sorted by `(blockNumber, logIndex)`.

Full catalog: [`skills/soulvault/references/events.md`](skills/soulvault/references/events.md)

## Testing

### Foundry (Solidity unit + integration tests)

```bash
forge test          # 50+ tests covering SoulVaultSwarm + SoulVaultTreasury
forge test -vvv     # verbose output with traces
```

### Vitest (CLI unit tests)

```bash
cd cli && pnpm test           # fast, no chain needed
cd cli && pnpm test:watch     # watch mode
```

### Integration tests (full-stack, local ens-app-v3 node)

The integration harness deploys contracts against a local [ens-app-v3](https://github.com/ensdomains/ens-app-v3) node on `localhost:8545` (chain id `1337`). Both the ops lane and the identity lane point at this single node during tests.

```bash
# 1. Start the ens-app-v3 local node (in a separate terminal)
#    Follow ens-app-v3 setup instructions — the node must be running before tests start.

# 2. Configure .env.test at the repo root (gitignored; tracked template below)
cp .env.test.example .env.test
# Edit .env.test:
#   - Point RPC URLs at your local node (default example: localhost:8545, chain 1337)
#   - Set ENS contract addresses from the ens-app-v3 / local deployment
#   - Use a funded key for that chain (the example uses Anvil account #0)

# 3. Run integration tests
cd cli && pnpm test:integration
```

The global setup verifies the ens-app-v3 node is reachable, the chain ID matches, funded accounts exist, and the ENS registry owns `.eth` before any test runs.

### Sepolia read-only smoke test

```bash
cd cli && pnpm test:ens-name    # reads minCommitmentAge from public Sepolia RPC
```

### Testnet smoke (real 0G Galileo)

```bash
cd cli && pnpm test:testnet     # requires SOULVAULT_TESTNET_INTEGRATION=1, funded key
```

## Stories

The [`stories/`](stories/) directory contains runnable, copy-paste walkthroughs:

| Story | Covers |
|-------|--------|
| [story00](stories/story00.md) | Bootstrap org + treasury + swarm + join/approve |
| [story01](stories/story01.md) | Browse orgs, swarms, member identities |
| [story02](stories/story02.md) | Agent profile + ERC-8004 on-chain identity |
| [story03](stories/story03.md) | Epoch rotation + verification |
| [story04](stories/story04.md) | Event-driven backup coordination |
| [story05](stories/story05.md) | Messaging protocol (detailed) |
| [story06](stories/story06.md) | Messaging quick-start (3 examples) |
| [story07](stories/story07.md) | Ledger signer: local vs on-chain signing |
| [story08](stories/story08.md) | Fund request flow: treasury, approval, rejection, failure modes |

## Repo layout

```
contracts/          Solidity interfaces + specs + protocol docs
cli/src/
  commands/         Thin Commander.js handlers (one per entity)
  lib/              Business logic (crypto, contract, storage, state)
  index.ts          CLI entry point
cli/test/           Integration test harness (global-setup, helpers)
docs/               Architecture, protocol, glossary, roadmap
stories/            Runnable demo walkthroughs
skills/soulvault/   Agent skill package (SKILL.md + references)
examples/           Standalone 0G SDK usage examples
slides/             Deck outline and presentation notes
test/               Foundry tests (SoulVaultSwarm, SoulVaultTreasury, fund requests)
```

## Key specs

- [`contracts/ISoulVaultSwarm.sol`](contracts/ISoulVaultSwarm.sol) — swarm contract interface
- [`contracts/ISoulVaultTreasury.sol`](contracts/ISoulVaultTreasury.sol) — treasury contract interface
- [`contracts/SWARM_CONTRACT_SPEC.md`](contracts/SWARM_CONTRACT_SPEC.md) — swarm contract specification
- [`contracts/TREASURY_CONTRACT_SPEC.md`](contracts/TREASURY_CONTRACT_SPEC.md) — treasury contract specification
- [`contracts/IERC8004AgentRegistryAdapter.sol`](contracts/IERC8004AgentRegistryAdapter.sol) — identity adapter
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
- [`references/contract.md`](skills/soulvault/references/contract.md) — contract reference (swarm + treasury)
- [`references/env.md`](skills/soulvault/references/env.md) — environment variables
- [`references/workflows.md`](skills/soulvault/references/workflows.md) — end-to-end workflows

## License

[MIT](LICENSE.md)

## Status

SoulVault is under active development. The CLI, swarm contract, treasury contract, fund-request flow, messaging, backup/restore, epoch rotation, Ledger signing, ENSIP-11 multichain treasury discovery, and ENS/ERC-8004 identity flows are implemented and tested on 0G Galileo + Sepolia.
