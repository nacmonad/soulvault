<div align="center">

<img alt="" src="assets/soulvault-mark.svg" width="96">

# SoulVault

**Coordinate securely. Collaborate privately.**

Encrypted continuity for agent swarms, and wallet-authorized selective
disclosure for confidential documents.

[![License: MIT](https://img.shields.io/badge/license-MIT-4F46E5.svg)](LICENSE.md)
[![Ops lane: Sepolia](https://img.shields.io/badge/ops-Sepolia-334155.svg)](https://sepolia.etherscan.io/)
[![Identity lane: Sepolia ENSv2](https://img.shields.io/badge/identity-Sepolia%20ENSv2-4F46E5.svg)](https://sepolia.etherscan.io/)

</div>

---

## What this is

Agent sessions are ephemeral. Shared state is ad hoc. Backups are uncoordinated.
Identity and permissions are fuzzy. Multi-agent systems need shared encrypted
state and verifiable coordination — and so do the humans working alongside them.

SoulVault is a coordination layer built on one cryptographic core
(secp256k1 ECDH + AES-256-GCM), applied to two problems:

**Continuity for agent swarms** — *shipped.* Encrypted backup, restore, and
transfer of swarm state across ephemeral sessions. Membership governance, epoch
key rotation, a three-mode messaging bus, and a fund-request treasury, all driven
by onchain contract events. With the Ledger Key Ring, epoch keys are
**derived, never stored** — a dead agent's successor recovers its memories with
a brand-new wallet and zero stored keys.

**Selective disclosure for documents** — *shipped (Sepolia).* Redaction runs
locally in the browser (presidio-web), so the artifact that travels through
email or Slack carries no sensitive fields at all. Authorized wallets
reconstruct only the slots they are permitted to see; grants are contract
events carrying ECDH-wrapped slot keys, and revocation blocks every future
reconstruction. Live org: `soulvault-ensv2.eth`.

## Architecture

SoulVault runs on a single EVM lane — Sepolia — for both ops and identity:

| Lane | Chain | Purpose |
|------|-------|---------|
| **Ops + Identity** | Sepolia (11155111) | Swarm contract, treasury contract, membership, epochs, document registry, ENSv2 naming (org roots, swarm/agent subnames, ENSIP-11 treasury discovery), ERC-8004 agent identity |

The swarm contract holds coordination truth: membership, epoch lineage,
messaging, fund requests, and epoch-key recovery requests. The treasury contract
holds native value and releases funds on approved requests. The document
registry carries slot-key grants as events — the event log IS the key delivery.
Encrypted artifacts (backups, escrows, bundles) travel as files over ordinary
channels or any storage backend you bring; **no SoulVault server holds keys or
ciphertext**. Bring your own RPC.

> The ops lane was originally 0G Galileo (chain 16602) and is now Sepolia-only;
> see [`docs/dashboard-ui/007-sepolia-only-ops-lane.md`](docs/dashboard-ui/007-sepolia-only-ops-lane.md)
> for the migration rationale. `SOULVAULT_RPC_URL` points at any Sepolia RPC —
> `https://ethereum-sepolia-rpc.publicnode.com` in the defaults.

### Entity model

```
Organization  (ENS root, admin boundary, optional treasury per chain)
  ├── Treasury         (SoulVaultTreasury — one per chain, discovered via ENSIP-11 addr)
  ├── DocumentRegistry (SoulVaultDocumentRegistry — org-scoped; publishes docs, carries
  │                     rehydration requests + slot-key grants; announced via the
  │                     `soulvault.documentRegistry` text record on the org ENS name)
  └── Swarm            (SoulVaultSwarm — one contract, one member set, one epoch-key lineage)
       └── Agent       (wallet + runtime + optional public identity)
```

- `acme.eth` — organization
- `ops.acme.eth` — swarm
- `rusty.ops.acme.eth` — agent (optional)

### ENS conventions

| Record | Location | Purpose |
|--------|----------|---------|
| `addr(orgNode, coinType)` | Org ENS name | ENSIP-11 multichain treasury address (`coinType = 0x80000000 \| chainId`) |
| `soulvault.treasuries` text record | Org ENS name | JSON array enumerating the org's treasuries — one `{chainId, address, label?, createdAt?}` entry per chain (ERC-634 has no key enumeration, so this single known key is the discovery index) |
| `class` text record | Org ENS name | `soulvault.organization` — signals this is a SoulVault org |
| `name` text record | Org ENS name | Human-readable org name |
| `soulvault.swarms` text record | Org ENS name | CBOR array of swarm labels (`data:application/cbor;base64,…`) — v1 discovery; superseded by per-swarm subname registration on ENSv2 |
| `soulvault.ensv2Registry` text record | Org ENS name | JSON `{version: 2, registry, owner, deployedAt?}` — address of the org's SoulVaultRegistry (UserRegistry proxy deployed via the VerifiableFactory). Authoritative for `*.<orgName>` subnames and the v1/v2 protocol marker readers use for auto-detection |
| `soulvault.swarmContract` text record | Swarm subdomain | Swarm contract address |
| `soulvault.chainId` text record | Swarm subdomain | Chain ID where the swarm contract lives |
| `soulvault.documentRegistry` text record | Org ENS name | Document registry address for redact/rehydrate flows |

Treasury discovery uses ENSIP-11 rather than text records so an org with
treasuries on multiple chains gets one slot per chain without clobbering. For
Sepolia: `coinType = 2147483839` (`0x80000000 | 11155111`).

The `soulvault.treasuries` text record complements the ENSIP-11 slots: because
resolvers can't enumerate text keys or coinTypes, a consumer that only knows the
org's ENS name would otherwise have to guess which chains hold treasuries. The
record is a JSON array, upserted per `chainId` on every `treasury create` /
`treasury bind` (CLI and browser wizard); the `addr` slot remains the source of
truth for resolution, and a mismatch between the two is a corruption signal.

### Signer model

| Role | Purpose | Recommended backend |
|------|---------|-------------------|
| **Admin** | ENS registration, join approvals, epoch rotation, treasury operations | Ledger (shipped, with clear-signing) |
| **Agent** | Backups, message posting, join requests, fund requests | Hot key |

Visibility posture shorthand:
- `public` = swarm name + public-safe metadata can be published through ENS
- `private` = no direct ENS publication required for the swarm
- `semi-private` = organization/root ENS may be public while the swarm itself remains undiscoverable

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in keys and RPC endpoints
pnpm soulvault status
```

`pnpm soulvault <command>` runs the CLI from source. To shorten it:

```bash
alias soulvault="pnpm --dir /path/to/soulvault soulvault"
```

Run through the [stories](stories/) for guided walkthroughs, starting with
[story00](stories/story00.md) (bootstrap).

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
| `organization register-ens` | Register ENS root on Sepolia + write org metadata records (`class`, `name`); `--ens-v2` forces the ENSv2 flow (org registry + epoch-bound expiry) |
| `organization set-ens-name` | Attach a root `.eth` name to an existing profile |
| `organization deploy-registry` | Deploy the org's ENSv2 SoulVaultRegistry (custom subname registry via VerifiableFactory) + record it on the org profile |

### Treasury
| Command | Description |
|---------|-------------|
| `treasury create` | Deploy treasury on the ops lane + publish ENSIP-11 addr on org ENS name |
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
| `swarm create` | Deploy contract on the ops lane (auto-discovers treasury via ENSIP-11) + bind ENS subdomain |
| `swarm register-ens` | Register the swarm subname in the org's ENSv2 registry with epoch-bound expiry (`--with-agent-namespace` enables agent subnames) |
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
| `agent register-ens` | Register `<agent>.<swarm>.<org>.eth` in the org registry + mirror the ERC-8004 identity into resolver records |
| `agent show --ens` | Reverse-resolve the agent's ENSv2 name back to its ERC-8004 identity |

### ENS (ENSv2)
| Command | Description |
|---------|-------------|
| `ens grant` | Grant an EAC role (e.g. `set-resolver`) on one name to a wallet — scoped delegation |
| `ens revoke` | Revoke a granted role |
| `ens roles` | Read the role bitmap on a name |

### Documents (redact / grant / rehydrate)
| Command | Description |
|---------|-------------|
| `document deploy-registry` | Deploy the SoulVaultDocumentRegistry + announce it on the org ENS name |
| `document announce-registry` | Point the org's `soulvault.documentRegistry` record at an existing registry |
| `document publish` | Publish a redacted artifact: `docHash` + slot ids onchain; encrypted slots travel in the bundle file |
| `request-rehydrate` | Requester asks for rehydration — emits `RehydrationRequested` with its rehydration pubkey |
| `document grants` | List rehydration requests / granted slots for a document |
| `document grant` | Author grants slots: wraps each slot key ECDH to the requester pubkey, posts `SlotKeyGranted` |
| `document rehydrate` | Requester unwraps granted slots and rehydrates the document locally |
| `document rehydration-key` | Show/generate this wallet's rehydration keypair |

Dashboard equivalents: `/dashboard/documents/{redact,grants,rehydrate,registry}`.

### Recovery (Ledger Key Ring)
| Command | Description |
|---------|-------------|
| `recovery escrow` | Create + ring-encrypt an agent's memory archive — key derived on-chip, never stored |
| `recovery restore` | Successor recovers: `requestEpochKey` → owner ring decrypts on-chip → ECDH grant DM → unwrap |
| `recovery sweep` | After member removal/rotation, re-escrow affected archives under the new epoch |
| `recovery show` | Inspect an escrow's header/manifest |

Full demo: [`examples/epoch-key-ring-demo/`](examples/epoch-key-ring-demo/).

### Epoch
| Command | Description |
|---------|-------------|
| `epoch rotate` | Generate K_epoch, wrap per member, upload bundle, call contract |
| `epoch show-bundle` | Fetch + display latest bundle |
| `epoch decrypt-bundle-member` | Verify current member can decrypt |

### Backup & Restore
| Command | Description |
|---------|-------------|
| `backup push` | Archive, encrypt with K_epoch, store bundle, publish file mapping |
| `restore pull` | Decrypt backup |
| `restore verify-latest` | Download + decrypt + verify hashes |

### Messaging
| Command | Description |
|---------|-------------|
| `msg post` | Post message (public / group / dm) |
| `msg list` | List all messages from contract events |
| `msg show --payload-ref <hash>` | Fetch + optionally decrypt a message payload |

### Sync
| Command | Description |
|---------|-------------|
| `sync` | Bootstrap org/swarm profiles from ENS on any new machine |

Full command reference: [`skills/soulvault/references/commands.md`](skills/soulvault/references/commands.md)

## Encryption model

**Before — stored `K_epoch`:** each swarm epoch had one shared symmetric key,
physically stored by every member (env var / config). Rotation meant generating
a new key, wrapping it per member's secp256k1 pubkey, uploading the bundle. Only
the wrapped bundle reference and hash went onchain. Failure modes: every
custodian holds every historic key; any custodian losing them = memories
permanently unrecoverable; a kicked member likely still holds copies; ephemeral
agents cannot self-custody at all.

**After — derived keys (Ledger Key Ring, `wallet-cli ring`):** epoch keys are
**derived, never stored**. Enrollment is a single Ledger-approved tap; after
that, encrypt/decrypt need only the trustchain service + the local member
credential — no device, no USB (this is what makes VPS / hosted-agent recovery
possible). A key is HKDF-derived from trustchain material with the key *name* as
domain separation: same name + same trustchain state ⇒ same 256-bit key, on any
enrolled machine. The canonical name
`soulvault:epoch-recovery:<agent-ens>:epoch-<n>` is the only durable metadata —
it is not secret and can appear in plaintext headers and logs.

**Catastrophic recovery:** a dead agent's successor (brand-new wallet) joins the
swarm and calls `requestEpochKey(keyName)` → `EpochKeyRequested` event → the
owner's Ledger ring derives + decrypts on-chip → payload re-wrapped ECDH to the
successor's pubkey → grant DM → byte-identical restore. Key material never
leaves the device at any step.

| What | How |
|------|-----|
| Backups | AES-256-GCM with ring-derived epoch key |
| Group messages | AES-256-GCM with K_epoch |
| Direct messages | Ephemeral ECDH + AES-256-GCM to recipient pubkey |
| Key wrapping | secp256k1-ECDH + AES-256-GCM per member |
| Epoch recovery | On-chip derivation (LKRP) + ECDH grant DM — zero stored keys |
| Document slots | Per-slot AES-256-GCM key, ECDH-wrapped to the grantee |

The primitives live in `@soulvault/protocol` and are isomorphic — the same code
runs in Node and in the browser, with no Node built-ins. Wire formats are locked
to what the original `node:crypto` implementation produced, and cross-checked
against it in both directions by `packages/protocol/test/crypto-compat.test.ts`.

Details: [`skills/soulvault/references/crypto.md`](skills/soulvault/references/crypto.md),
[`docs/epoch-key-ring-spec.md`](docs/epoch-key-ring-spec.md),
[`docs/epoch-key-grant-protocol.md`](docs/epoch-key-grant-protocol.md)

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
| `EpochKeyRequested` | Successor asks for epoch-key recovery (key name + requester pubkey) |
| `HistoricalKeyBundleGranted` | Key recovery for new/restored members |
| `DocumentPublished` / `RehydrationRequested` / `SlotKeyGranted` | Document registry: publish, request, grant lifecycle |
| `TreasurySet` | Treasury binding (constructor or `setTreasury`) |
| `FundRequested` / `FundRequestApproved` / `FundRequestRejected` / `FundRequestCancelled` | Fund request lifecycle |

### Treasury events
| Event | Trigger |
|-------|---------|
| `FundsDeposited` | Deposit received |
| `FundsReleased` | Fund request approved + payout |
| `FundRequestRejectedByTreasury` | Fund request rejected |
| `TreasuryWithdrawn` | Owner withdrawal |

When a swarm has a bound treasury, `swarm events watch` merges events from both
contracts into a single stream sorted by `(blockNumber, logIndex)`.

Full catalog: [`skills/soulvault/references/events.md`](skills/soulvault/references/events.md)

## Repo layout

```
contracts/          Solidity interfaces + specs + protocol docs
packages/
  protocol/         @soulvault/protocol — isomorphic core (crypto, wire formats); runs in Node + browsers
  node/             @soulvault/node — business-logic handlers (contracts, signer, ring backend, ENS/ENSv2, state cache)
    test/           Integration test harness (global-setup, helpers, speculos)
apps/
  cli/              soulvault-cli — thin Commander.js handlers over @soulvault/node
  web/              soulvault-web — Next.js app (landing + dashboard: documents, swarm, treasury, org)
    brand/          Brand package: context, strategy, visual identity
docs/               Architecture, protocol, glossary, roadmap, dashboard-ui ADRs
stories/            Runnable demo walkthroughs
skills/soulvault/   Agent skill package (SKILL.md + references)
examples/           Standalone demos (epoch-key-ring: zero-stored-key recovery)
slides/             ETHOnline 2026 Marp deck (EthOnline2026/DECK.md)
test/               Foundry tests (SoulVaultSwarm, SoulVaultTreasury, SoulVaultDocumentRegistry, fund requests)
```

Dependency direction is `apps/cli → @soulvault/node → @soulvault/protocol`.
The web app imports `@soulvault/node` from server code only (it touches `fs` and
Ledger HID) and `@soulvault/protocol` from anywhere.

## Testing

```bash
pnpm test              # all workspace unit tests (45 vitest tests)
forge test             # 60 Solidity tests across SoulVaultSwarm + SoulVaultTreasury
pnpm typecheck         # all four workspace packages
```

Per-package and integration suites:

```bash
cd packages/node && pnpm test:watch         # watch mode
cd packages/node && pnpm test:ens-name      # Sepolia read-only smoke (needs .env)
cd packages/node && pnpm test:integration   # full-stack against a local ens-app-v3 node
cd packages/node && pnpm test:speculos      # Ledger clear-signing against the Speculos simulator
cd packages/node && pnpm test:testnet       # gated smoke against the live Sepolia lane
```

The integration harness deploys contracts against a local
[ens-app-v3](https://github.com/ensdomains/ens-app-v3) node on `localhost:8545`
(chain id `1337`); both lanes point at that single node during tests. Config
lives in `.env.test` at the repo root — copy `.env.test.example` and adjust ENS
addresses for your local deployment. The global setup verifies the node is
reachable, the chain ID matches, funded accounts exist, and the ENS registry owns
`.eth` before any test runs.

Speculos suites need Docker and a Ledger app ELF; see
[`docs/clear-signing-runbook.md`](docs/clear-signing-runbook.md).

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

## Key specs

- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/protocol-v0.1.md`](docs/protocol-v0.1.md) — protocol specification
- [`docs/glossary.md`](docs/glossary.md) — terminology
- [`docs/technologies.md`](docs/technologies.md) — Ethereum / ENS / ERC-8004 standards SoulVault touches
- [`docs/clear-signing-spec.md`](docs/clear-signing-spec.md) — Ledger clear-signing spec and ERC-7730 descriptors
- [`contracts/SWARM_CONTRACT_SPEC.md`](contracts/SWARM_CONTRACT_SPEC.md) — swarm contract specification
- [`contracts/TREASURY_CONTRACT_SPEC.md`](contracts/TREASURY_CONTRACT_SPEC.md) — treasury contract specification
- [`contracts/MESSAGE_PROTOCOL.md`](contracts/MESSAGE_PROTOCOL.md) — messaging protocol

## Agent skill

A repo-local skill package at [`skills/soulvault/`](skills/soulvault/) teaches
agents how to use SoulVault — [`SKILL.md`](skills/soulvault/SKILL.md) plus
references for [commands](skills/soulvault/references/commands.md),
[events](skills/soulvault/references/events.md),
[crypto](skills/soulvault/references/crypto.md),
[contracts](skills/soulvault/references/contract.md),
[env](skills/soulvault/references/env.md), and
[workflows](skills/soulvault/references/workflows.md).

## #ethglobalonline2026 notes

SoulVault's hackathon submission is the private redaction/rehydration service:
documents are redacted locally, encrypted disclosure slots are stored offchain,
and wallet-authorized recipients can rehydrate only the fields they are permitted
to see. Sponsor integrations support that product; they are not substitutes for
the core use case.

### Ledger track progress

- Migrated the Ledger signing path to Device Management Kit (DMK) 1.8 and the
  Ethereum Signer Kit while retaining browser-wallet sign-in as an equal option.
- Added a shared wallet-session boundary for browser wallets and direct Ledger
  devices, including connection, verification, rejection, teardown, and reconnect
  states.
- Added wallet-scoped discovery so a signed-in address can reconstruct its
  SoulVault context from contract events and onchain state.
- Added deterministic integration coverage against Ledger's official Speculos
  image and Ethereum 1.22.3 Nano S Plus application.
- Verified the local ENS v3/Anvil lane and DMK + Speculos lane: 21 standard
  integration tests and 12 hardware-emulation integration tests pass.
- Proposed the reusable, test-only
  [`@soulvault/dmk-speculos-browser`](packages/dmk-speculos-browser/TODO.md)
  package so browser applications can exercise DMK device-action flows in CI.
- Evaluated Ledger Wallet CLI Key Ring support as an optional owner-recovery
  backend for hydration bundles. The proposed integration ring-encrypts an
  owner escrow of per-slot keys while preserving recipient-specific grants;
  it does not replace browser hydration, onchain authorization, or revocation.
  See the [Key Ring fit analysis](docs/research/ledger-key-ring-cli.md).
- **Shipped the epoch key ring** ([`docs/epoch-key-ring-spec.md`](docs/epoch-key-ring-spec.md)):
  epoch keys are HKDF-derived on-chip from trustchain material via
  `wallet-cli ring` — never stored. Agents enroll once (one Ledger tap);
  afterwards encrypt/decrypt need only the trustchain service. Catastrophic
  recovery: a dead agent's successor joins with a brand-new wallet, requests
  via `requestEpochKey`, and the owner's ring derives + decrypts on-chip and
  re-wraps ECDH to the successor — zero stored keys, byte-identical restore.

### Ledger developer challenge notes

These notes are a running record of integration friction, solutions, and feedback
for the Ledger developer tooling challenge.

| Area | Finding | Resolution / feedback |
|------|---------|-----------------------|
| Browser CI | Speculos exposes APDU over TCP/HTTP and therefore does not appear in Chromium's WebHID device picker. | Build an explicitly emulated, test-only DMK transport over the Speculos APDU bridge. Keep one physical Ledger/WebHID check as separate release evidence. |
| DMK lifecycle | Context Module 2.5 requires the chain to be selected before the module is built. | Call `setChain(Ethereum)` before `build()`. A focused migration example or earlier runtime error would reduce integration time. |
| Device approvals | Thirty seconds is tight for reviewing and approving device prompts in integration environments. | Use a 60-second Ledger approval timeout and poll observable device state rather than relying on fixed sleeps. |
| Speculos fixtures | Current official Speculos images do not bundle application ELFs at the path older extraction helpers expect. | Provision the official application ELF separately, verify its published digest, and never redistribute it in the package tarball. Documentation should make this version boundary explicit. |
| Local RPC deployment | Ethers' short-lived RPC cache can reuse a stale funder nonce during back-to-back hardware-test deployments. | Disable provider caching in the Speculos test lane. This is test-harness behavior, not a signer workaround. |
| ENS v3 integration | Current ENS v3 registrar calls use a `Registration` tuple and return tuple pricing, unlike the older flat argument/result shape. | Updated the local integration fixture and deployment calls to the current ABI. |
| Key Ring CLI | `wallet-cli ring` provisions through a Ledger once, then performs named-key AES-256-GCM encryption/decryption from an enrolled host using a local protected credential and Ledger's network trustchain; routine decrypt is not a fresh device approval. | Use it as an additive, seed-recoverable owner-escrow or CLI continuity backend. Keep independent slot keys, recipient wrapping, and onchain grant/revoke checks as SoulVault's authorization layer. |

### Evidence and honest limits

- Automated coverage proves DMK session behavior, Ethereum address derivation,
  signing approval/rejection, disconnect/reconnect, and SoulVault context loading.
- Speculos coverage is hardware-app emulation; it does **not** prove browser USB
  discovery, physical possession, hardware attestation, or the WebHID permission UI.
- Final sponsor evidence should include CI logs and device-screen transcripts from
  the emulated lane plus one concise manual run using a physical Ledger over WebHID.
- Package implementation status and acceptance criteria live in
  [`packages/dmk-speculos-browser/TODO.md`](packages/dmk-speculos-browser/TODO.md).

### World track progress

- Selected the World ID **Selfie Check (Beta)** credential (ID 11) as the
  requester-side human-presence gate for document rehydration: before an author
  approves a rehydrate request, their node verifies the requester's Selfie Check
  proof (liveness + face match) and resolves the requester's World identity prior
  to transmitting the encrypted bundle via smart contract event.
- Added `@worldcoin/agentkit` and `@worldcoin/idkit-core` to `@soulvault/node`
  as the integration surface; the `agentkit-x402` skill is installed for
  agent-side integration reference.
- Planned PoC coverage: grant approval gated on a verified Selfie Check proof,
  rejection on missing/expired proofs, and AgentBook resolution of the
  grant-recipient wallet. Sandbox testing follows the World ID Sandbox App
  flow once the Selfie Check feature flag is enabled for the app.

### World developer challenge notes

These notes are a running record of integration friction, solutions, and feedback
for the World developer tooling challenge (same format as the Ledger notes above).

| Area | Finding | Resolution / feedback |
|------|---------|-----------------------|
| Selfie Check access | Selfie Check (Beta) is feature-flag gated per app; docs direct developers to request access through a World point of contact before any proof flow can run, including in Sandbox. | Requested enablement for the SoulVault sandbox app. Earlier self-serve sandbox enablement (or a documented SLA for the access request) would remove the biggest lead-time risk for hackathon timelines. |
| Credential surface | Selfie Check returns a proof of completed check, not a uniqueness score; validity is a fixed 90-day window. | Treat the proof as an authorization-time signal (verify at grant approval), not a stored identity attribute. |
| Docs discoverability | `docs.world.org/llms.txt` provides a clean LLM-facing index and the Developer Portal exposes an MCP context server; both materially reduce hallucinated SDK usage. | Keep the MCP endpoint and `llms.txt` index in sync with SDK releases; note SDK versions (`@worldcoin/agentkit`, `@worldcoin/idkit-core`) in the quickstart so agents can pin correctly. |

### ENS track progress

- Shipped an ENSv2-first architecture on Sepolia: the org's config layer IS a custom
  ENSv2 subname registry (UserRegistry proxy deployed via the canonical VerifiableFactory),
  not a side database. Org → swarm → agent is a real registry hierarchy with epoch-bound
  expiries, EAC role bitmaps, and Permissioned Resolvers.
- **Phase 1 — v2 client + dispatch.** `ensv2.ts` implements the v2 hierarchy walk
  (label-string navigation, per-label resolver slots, name state, EAC role checks); every
  ENS read/write entry point in `ens.ts` dispatches v1 ↔ v2 on one feature flag.
- **Phase 2 — org registry + swarm subnames.** `organization deploy-registry` deploys the
  org's SoulVaultRegistry (verifiable proxy, deployer holds all root roles); `swarm
  register-ens` registers `<swarm>.<org>.eth` with expiry = epoch length, replacing the
  CBOR `soulvault.swarms` membership list with real registry entries.
- **Phase 3 — EAC scoped delegation.** `ens grant/revoke/roles` delegate exactly the roles
  needed on exactly one name (e.g. `set-resolver` on the swarm name to the agent wallet);
  every grant is verified onchain post-tx before the CLI claims success.
- **Phase 4 — expiry as liveness + ERC-8004 bridge.** Every epoch rotation renews the
  swarm's subname (best-effort, never blocks rotation); `agent register-ens` registers
  `<agent>.<swarm>.<org>.eth` and mirrors the ERC-8004 identity into the name's resolver
  records; `agent show --ens` reverse-resolves the name back to the ERC-8004 identity.
- **Test coverage:** 118 unit tests (network-free, mocked contracts) + a 6/6 forge spike
  against the vendored ENSv2 contracts; live Sepolia demo pending a funded wallet.

### ENS developer challenge notes

These notes are a running record of integration friction, solutions, and feedback for the
ENS developer challenge (same format as the Ledger/World notes above).

| Area | Finding | Resolution / feedback |
|------|---------|-----------------------|
| v2 name navigation | ENSv2 replaces labelhash-keyed registry traversal with per-label string navigation (`getSubregistry(label)` / `getResolver(label)` on the registry HOLDING the name). Code ported from v1 labelhash walks breaks silently if it keeps hashing. | Centralize the hierarchy walk in one client (`ensv2.ts`) and dispatch all v1 call sites through it; pin ABIs to a known contracts-v2 commit and note it in-source. |
| Beta deployments | ENSv2 Sepolia contracts (ETHRegistry, ETHRegistrar, ENSV2Resolver) are beta and can redeploy; discovery docs are the only stable reference. | All pinned addresses are env-overridable (`SOULVAULT_ENSV2_*`); the code treats docs.ens.domains deployments as defaults, not constants. |
| Custom subname registries | Third-party namespace operators deploy their own UserRegistry via the VerifiableFactory; there is no turnkey "deploy my subname registry" CLI. | Wrapped the factory flow (deploy proxy → initialize with root roles → verify ROLE_REGISTRAR onchain before trusting the address) into one `organization deploy-registry` command. A first-class ENS SDK for subname-registry operators would remove the proxy-verification footwork. |
| Expiry semantics | `register()` takes a `uint64` absolute expiry; there is no native "extend by epoch" helper, and expired names change state visibly. | Model expiry as liveness: one renewal per epoch rotation in the same transaction flow that publishes the new key bundle, so name expiry can never outrun operational continuity. |
| EAC role granularity | The role bitmap (nybble-packed) enables per-name, per-role delegation — far finer than v1's resolver-level permissions, but there is no built-in "agent record editing" preset. | Standardized two presets in the CLI: swarm names get SET_RESOLVER\|RENEW, agent names get the same minus any unregister/parent rights; `ens grant` post-verifies the bitmap onchain before reporting success. |
| Resolver record portability | Text-record ABI is unchanged from v1, but the resolver is now per-label (each registry entry points at its own Permissioned Resolver), so "the resolver address" is a property discovered by walking, not a global. | All `setText`/`text` paths resolve the target resolver from the hierarchy at call time; callers never handle resolver addresses. |
| Browser-side protocol detection | `SOULVAULT_ENSV2` is a node env var; the dashboard has no env channel, and hard-coding a mode picker would split the org UX per protocol. | Made the protocol self-describing onchain: the org name carries a `soulvault.ensv2Registry` pointer record written at deploy time. The dashboard reads it to pick the right wizard (v2 present ⇒ v2 wizard, absent ⇒ legacy v1 commit/reveal flow untouched), with a localStorage override for testing. One source of truth, shared with the node package's org-profile `ensv2Registry` field. |
| Dual-wizard registration UX | The v1 (commit/reveal/wait/unwrap) and v2 (deploy registry → register with epoch expiry) flows have structurally different steps — forcing them through one state machine would mean conditionals in every phase. | Dedicated v2 org-registration wizard sharing the same scaffolding (wallet hooks, step list, CLI recovery hints, TxChannel write path so injected-wallet and Ledger connectors both work unchanged). Grant/renew/role flows stay shared — they map 1:1 across versions and dispatch underneath. |
| Factory proxy address discovery | The VerifiableFactory emits no dedicated deployment event; the proxy address must come from the deploy receipt's `contractAddress` (or receipt logs on channels that don't surface it). | The web wizard reads `contractAddress` from the wallet receipt with a raw `eth_getTransactionReceipt` fallback, then post-verifies `ROLE_REGISTRAR` on the root resource onchain before trusting the address — same trust rule as the node CLI. |

## Roadmap

**Working today.** The CLI, swarm contract, treasury contract, fund-request flow,
messaging, backup/restore, epoch rotation, Ledger signing with clear-sign modes,
ENSIP-11 multichain treasury discovery, ENS/ERC-8004 identity flows, and the
ENSv2 registry hierarchy are implemented and tested on Sepolia — including the
document redact/grant/rehydrate loop (`SoulVaultDocumentRegistry` + dashboard)
and the epoch-key-ring recovery flow (ring-derived keys, escrow, grant DM).

**Also shipped this event:**

- **Ledger Key Ring recovery** — epoch keys derived on-chip from trustchain
  material (`wallet-cli ring`); escrowed memories recoverable by a successor
  with a brand-new wallet and zero stored keys
- **ENSv2 agent succession** — EAC-scoped role delegation (`ens grant/revoke`),
  burn + re-register of an agent's subname (`ROLE_UNREGISTER` → new
  `ROLE_REGISTRAR`), so identity survives the wallet
- **Document registry on Sepolia** — `DocumentPublished`,
  `RehydrationRequested`, `SlotKeyGranted` events as the key-distribution
  channel; dashboard panels at `/dashboard/documents/*`
- **World ID Selfie Check** — optional requester-side human-presence gate on
  rehydration grants (fail-closed when enabled), pending sandbox access

Deferred by design (see
[`docs/redaction-hydration-spec.md`](docs/redaction-hydration-spec.md)): the
x402 payment rail, the `DocumentViewTask` state machine, commitments, and the
USE engines (TEE/zk compute over a field without disclosing it).

> **Update:** 0G is no longer a sponsor of ETHOnline 2026. The ops lane is
> Sepolia-only
> ([`docs/dashboard-ui/007-sepolia-only-ops-lane.md`](docs/dashboard-ui/007-sepolia-only-ops-lane.md));
> encrypted artifacts travel as files over ordinary channels — bring your own
> storage, bring your own RPC. The authoritative redaction/rehydration design
> is [redaction-hydration-spec.md](docs/redaction-hydration-spec.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — it covers the gitleaks pre-commit hook
and the secrets policy. Never commit `.env` or private keys.

## License

[MIT](LICENSE.md)
