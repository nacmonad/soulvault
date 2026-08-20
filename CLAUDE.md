# CLAUDE.md — Agent onboarding for SoulVault

This file tells AI coding agents how to work in this repository. Read it before touching code.

## What is SoulVault?

An event-driven coordination and continuity layer for agent swarms. It combines:
- A **swarm contract** on 0G Galileo for membership, epochs, encrypted backups, messaging, and fund request lifecycle
- A **treasury contract** on 0G Galileo (one per organization) that holds native value and releases funds on approved fund requests
- **0G Storage** for encrypted offchain artifacts (backups, key bundles, message envelopes)
- **ERC-8004** on Sepolia for public agent identity
- **ENS** on Sepolia for organization/swarm naming + treasury discovery
- A **TypeScript CLI** that ties it all together

## Quick orientation

This is a pnpm workspace monorepo:

```
contracts/              Solidity interfaces + spec docs (source of truth for onchain behavior)
packages/protocol/      @soulvault/protocol — isomorphic core (crypto, wire formats).
                        No Node built-ins allowed; must run in Node AND browsers.
packages/node/src/      @soulvault/node — business logic (contract calls, signer, 0G, ENS, state)
apps/cli/src/commands/  Thin Commander.js handlers — one file per entity
apps/cli/src/index.ts   CLI entry point — all commands registered here
docs/                   Deep architecture, protocol, glossary
stories/                Runnable demo walkthroughs (story00–story07)
skills/soulvault/       Agent skill package with full reference docs
examples/               Standalone 0G SDK usage examples
```

Dependency direction: `apps/cli` → `@soulvault/node` → `@soulvault/protocol`. A future
Next.js app will import `@soulvault/node` from API routes and `@soulvault/protocol` from
browser code. Internal packages export TypeScript source directly (`exports` → `./src/*.ts`);
only `apps/cli` has a build step (tsup bundles the workspace packages into `dist/`).

## Running the CLI

```bash
pnpm soulvault <command>            # root script, or:
pnpm exec tsx apps/cli/src/index.ts <command>
```

Environment is loaded from `.env` via `packages/node/src/config.ts` (zod-validated). Copy `.env.example` to `.env` and fill in credentials before running.

## Two-lane architecture

| Lane | Chain | Chain ID | RPC env var | Purpose |
|------|-------|----------|-------------|---------|
| Ops | 0G Galileo | `16602` | `SOULVAULT_RPC_URL` | Swarm contract, backups, messages, epochs |
| Identity | Sepolia | `11155111` | `SOULVAULT_ETH_RPC_URL` | ENS names, ERC-8004 agent registry |

Both lanes share a single signer wallet. The CLI routes to the correct chain automatically.

## Key entities and their CLI surface

| Entity | Commands | State file |
|--------|----------|------------|
| Status | `status [--json] [--offline]` | (aggregates all state) |
| Organization | `organization create/list/use/status/register-ens/set-ens-name` (register-ens also publishes draft-ENSIP `class`/`name` metadata records on the org's ENS name) | `~/.soulvault/organizations/<slug>.json` |
| Swarm | `swarm create/remove/unpublish/list/use/status/join-request/approve-join/member-identities/set-treasury/treasury-status/fund-request/cancel-fund-request/fund-status/fund-requests` (create auto-discovers the org's treasury via ENSIP-11 `addr(orgNode, coinType)` unless `--treasury` override or stealth mode; create also takes `--public`/`--semi-private`/`--private`, which gate ENS binding and org listing before deploy. `unpublish` retracts ENS presence — records cleared, subnode released, org-list label stripped — leaving contract, profile, and membership intact; `--delist-only` stops at semi-private) | `~/.soulvault/swarms/<slug>.json` (archived swarms at `~/.soulvault/swarms/.archived/<slug>.json`) |
| Treasury | `treasury create/list/status/deposit/withdraw/approve-fund/reject-fund/fund-requests` | `~/.soulvault/treasuries/<orgSlug>.json` |
| Agent | `agent create/status/register/update/show` | `~/.soulvault/agent.json` |
| Epoch | `epoch rotate/show-bundle/decrypt-bundle-member` | `~/.soulvault/keys/<swarm>/epoch-<n>.json` |
| Backup | `backup push/request` + `restore pull/verify-latest` | `~/.soulvault/last-backup.json` |
| Message | `msg post/list/show` | — (stateless, reads from contract events + 0G) |
| Events | `swarm events list/watch` (merges swarm + treasury events when bound) | — |

## Code patterns

- **Command handlers are thin.** They parse CLI args and call into `packages/node/src/`. Do not put business logic in `apps/cli/src/commands/`.
- **Contract interactions** go through `packages/node/src/swarm-contract.ts` which holds the ABI fragments and typed wrappers.
- **Environment validation** uses `zod` in `packages/node/src/config.ts`. Add new env vars there with defaults.
- **Signer** is resolved by `packages/node/src/signer.ts` — supports `private-key`, `mnemonic`, and `ledger` modes.
- **0G uploads** go through `packages/node/src/0g.ts`. Returns `{ rootHash, txHash }`.
- **Local state** is managed by `packages/node/src/state.ts` + `packages/node/src/paths.ts`.

## Cryptography — do not guess

Primitives live in `packages/protocol/src/crypto.ts` (noble libraries, isomorphic). The wire
formats are locked to what the original node:crypto implementation produced — the compat
contract is documented in that file and enforced by `packages/protocol/test/crypto-compat.test.ts`,
which cross-checks against node:crypto in both directions. Do not change formats without a
protocol version bump and updated compat tests.

- **K_epoch wrapping:** secp256k1-ECDH + AES-256-GCM. Primitives in `@soulvault/protocol`; bundle assembly in `packages/node/src/epoch-bundle.ts`.
- **Backup encryption:** AES-256-GCM with K_epoch. Implemented in `packages/node/src/backup.ts`.
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
- `TreasurySet` — swarm bound to a treasury (also emitted from the `SoulVaultSwarm` constructor when `initialTreasury != address(0)`; the CLI passes the org's ENSIP-11-discovered treasury address through at deploy time)
- `FundRequested` / `FundRequestApproved` / `FundRequestRejected` / `FundRequestCancelled` — fund request lifecycle

The treasury contract emits its own events: `FundsDeposited`, `FundsReleased`, `FundRequestRejectedByTreasury`, `TreasuryWithdrawn`. When a swarm has a bound treasury, `swarm events watch` / `events list` automatically merge events from both contracts and order them by `(blockNumber, logIndex)` — critical for the same-tx pair `FundRequestApproved` (swarm) → `FundsReleased` (treasury) to render in correct order.

Full catalog: `skills/soulvault/references/events.md`

## Testing

```bash
cd packages/node && pnpm test              # vitest, single run (unit tests, fast, no chain needed)
cd packages/node && pnpm test:watch        # vitest watch
cd packages/node && pnpm test:ens-name     # Sepolia read-only controller smoke test (needs .env; sets SOULVAULT_INTEGRATION=1)
cd packages/node && pnpm test:integration  # full-stack integration test — deploys contracts against a local ens-app-v3 node on localhost:8545; config via .env.test
cd packages/node && pnpm test:testnet      # gated testnet smoke (SOULVAULT_TESTNET_INTEGRATION=1, real 0G Galileo, funded key required)
forge test                       # Foundry unit + integration tests for SoulVaultSwarm + SoulVaultTreasury (50+ tests)
```

The full-stack integration harness (`test:integration`) expects a local ens-app-v3 node running on `localhost:8545` (chain id `1337`). Both the ops lane and the identity lane point at this single node during tests. Config lives in `.env.test` at the **repo root** (gitignored). Copy from `.env.test.example` and adjust ENS addresses for your local node.

Full `register-ens` still requires a **funded** Sepolia wallet; the `test:ens-name` script above only reads `minCommitmentAge` from the public RPC.

## Stories as executable documentation

The `stories/` directory contains numbered walkthroughs. Each one is designed to be copy-pasted into a terminal. They serve as both documentation and integration test scripts:

| Story | Covers |
|-------|--------|
| story00 | Bootstrap org + swarm + join/approve |
| story01 | Browse orgs, swarms, member identities |
| story02 | Agent profile creation + ERC-8004 on-chain identity |
| story03 | Epoch rotation + verification |
| story04 | Event-driven backup coordination |
| story05 | Messaging protocol (detailed) |
| story06 | Messaging quick-start (3 examples) |
| story07 | Ledger: local profile/sync vs on-chain signing |
| story08 | Fund request flow (agent requests funds, treasury owner approves/rejects) |

## When editing this repo

1. **Adding a CLI command:** handler in `apps/cli/src/commands/`, logic in `packages/node/src/`, wire in `apps/cli/src/index.ts`, update `skills/soulvault/references/commands.md`
2. **Adding a contract event:** update `ISoulVaultSwarm.sol` (or `ISoulVaultTreasury.sol`), the matching spec doc (`SWARM_CONTRACT_SPEC.md` / `TREASURY_CONTRACT_SPEC.md`), ABI in `swarm-contract.ts` (or `treasury-contract.ts`), and `skills/soulvault/references/events.md`
3. **Adding a story:** create `stories/storyNN.md`, update `stories/README.md`
4. **Changing crypto:** primitives belong in `packages/protocol` (isomorphic — no Node built-ins, no Buffer); update the compat tests, `skills/soulvault/references/crypto.md`, and this file
5. **Changing env vars:** update `packages/node/src/config.ts` (zod schema), `.env.example`, and `skills/soulvault/references/env.md`
6. **Adding or changing the test harness:** update `packages/node/test/global-setup.ts`, `packages/node/test/helpers/`, and `packages/node/vitest.integration.config.ts` as needed. Keep `pnpm test` fast and dependency-free; integration tests live under `packages/node/src/__integration__/` and run only via `pnpm test:integration`.

## Do not

- Commit `.env` or private keys
- Store plaintext keys anywhere except `~/.soulvault/keys/`
- Put business logic in command handlers
- Change crypto primitives without updating the full pipeline and docs
- Skip updating `skills/soulvault/references/` when changing CLI behavior — these are the agent-facing source of truth
