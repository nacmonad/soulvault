# CLAUDE.md — Agent onboarding for SoulVault

This file tells AI coding agents how to work in this repository. Read it before touching code.

## What is SoulVault?

An event-driven coordination and continuity layer for agent swarms. It combines:
- A **swarm contract** on 0G Galileo for membership, epochs, encrypted backups, and messaging
- **0G Storage** for encrypted offchain artifacts (backups, key bundles, message envelopes)
- **ERC-8004** on Sepolia for public agent identity
- **ENS** on Sepolia for organization/swarm naming
- A **TypeScript CLI** that ties it all together

## Quick orientation

```
contracts/         Solidity interfaces + spec docs (source of truth for onchain behavior)
cli/src/commands/  Thin Commander.js handlers — one file per entity
cli/src/lib/       Business logic (crypto, contract calls, state, storage)
cli/src/index.ts   CLI entry point — all commands registered here
docs/              Deep architecture, protocol, glossary
stories/           Runnable demo walkthroughs (story00–story06)
skills/soulvault/  Agent skill package with full reference docs
examples/          Standalone 0G SDK usage examples
```

## Running the CLI

```bash
pnpm exec tsx cli/src/index.ts <command>
```

Environment is loaded from `.env` via `cli/src/lib/config.ts` (zod-validated). Copy `.env.example` to `.env` and fill in credentials before running.

## Two-lane architecture

| Lane | Chain | Chain ID | RPC env var | Purpose |
|------|-------|----------|-------------|---------|
| Ops | 0G Galileo | `16602` | `SOULVAULT_RPC_URL` | Swarm contract, backups, messages, epochs |
| Identity | Sepolia | `11155111` | `SOULVAULT_ETH_RPC_URL` | ENS names, ERC-8004 agent registry |

Both lanes share a single signer wallet. The CLI routes to the correct chain automatically.

## Key entities and their CLI surface

| Entity | Commands | State file |
|--------|----------|------------|
| Organization | `organization create/list/use/status/register-ens` | `~/.soulvault/organizations/<slug>.json` |
| Swarm | `swarm create/list/use/status/join-request/approve-join/member-identities` | `~/.soulvault/swarms/<slug>.json` |
| Agent | `agent create/status/register/update/show` | `~/.soulvault/agent.json` |
| Epoch | `epoch rotate/show-bundle/decrypt-bundle-member` | `~/.soulvault/keys/<swarm>/epoch-<n>.json` |
| Backup | `backup push/request` + `restore pull/verify-latest` | `~/.soulvault/last-backup.json` |
| Message | `msg post/list/show` | — (stateless, reads from contract events + 0G) |
| Events | `swarm events list/watch` | — |

## Code patterns

- **Command handlers are thin.** They parse CLI args and call into `cli/src/lib/`. Do not put business logic in `cli/src/commands/`.
- **Contract interactions** go through `cli/src/lib/swarm-contract.ts` which holds the ABI fragments and typed wrappers.
- **Environment validation** uses `zod` in `cli/src/lib/config.ts`. Add new env vars there with defaults.
- **Signer** is resolved by `cli/src/lib/signer.ts` — supports `private-key`, `mnemonic`, and `ledger` modes.
- **0G uploads** go through `cli/src/lib/0g.ts`. Returns `{ rootHash, txHash }`.
- **Local state** is managed by `cli/src/lib/state.ts` + `cli/src/lib/paths.ts`.

## Cryptography — do not guess

- **K_epoch wrapping:** secp256k1-ECDH + AES-256-GCM. Implemented in `cli/src/lib/epoch-bundle.ts`.
- **Backup encryption:** AES-256-GCM with K_epoch. Implemented in `cli/src/lib/backup.ts`.
- **Group messages:** AES-256-GCM with K_epoch. AAD = `{from, to, topic}`.
- **DM messages:** Ephemeral ECDH + AES-256-GCM to recipient pubkey.
- **Never log plaintext keys.** Key storage is `~/.soulvault/keys/` only.

If you need to understand the crypto model, read `skills/soulvault/references/crypto.md`.

## Contract events

The swarm contract emits events that drive the protocol. Key events:
- `JoinRequested` / `JoinApproved` — membership lifecycle
- `EpochRotated` — new K_epoch available
- `BackupRequested` — coordinated backup trigger
- `MemberFileMappingUpdated` — backup publication proof
- `AgentMessagePosted` — messaging
- `HistoricalKeyBundleGranted` — key recovery for new/restored members

Full catalog: `skills/soulvault/references/events.md`

## Testing

```bash
pnpm test              # vitest, watch mode
pnpm test -- --run     # single run
```

For integration tests that hit live chains, ensure `.env` is configured with funded wallets.

## Stories as executable documentation

The `stories/` directory contains numbered walkthroughs. Each one is designed to be copy-pasted into a terminal. They serve as both documentation and integration test scripts:

| Story | Covers |
|-------|--------|
| story00 | Bootstrap org + swarm + join/approve |
| story01 | Browse orgs, swarms, member identities |
| story03 | Epoch rotation + verification |
| story04 | Event-driven backup coordination |
| story05 | Messaging protocol (detailed) |
| story06 | Messaging quick-start (3 examples) |

## When editing this repo

1. **Adding a CLI command:** handler in `commands/`, logic in `lib/`, wire in `index.ts`, update `skills/soulvault/references/commands.md`
2. **Adding a contract event:** update `ISoulVaultSwarm.sol`, `SWARM_CONTRACT_SPEC.md`, ABI in `swarm-contract.ts`, and `skills/soulvault/references/events.md`
3. **Adding a story:** create `stories/storyNN.md`, update `stories/README.md`
4. **Changing crypto:** update `skills/soulvault/references/crypto.md` and this file
5. **Changing env vars:** update `cli/src/lib/config.ts` (zod schema), `.env.example`, and `skills/soulvault/references/env.md`

## Do not

- Commit `.env` or private keys
- Store plaintext keys anywhere except `~/.soulvault/keys/`
- Put business logic in command handlers
- Change crypto primitives without updating the full pipeline and docs
- Skip updating `skills/soulvault/references/` when changing CLI behavior — these are the agent-facing source of truth
