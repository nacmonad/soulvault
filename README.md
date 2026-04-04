# SoulVault

SoulVault is an event-driven coordination and continuity layer for agent swarms.

It combines:
- a **SoulVault swarm contract** for membership, epochs, recovery references, file mappings, and coordination events
- a **SoulVault CLI** for backup, restore, rekey, watch, and identity operations
- **0G Storage** for encrypted memories/backups and related ciphertext artifacts
- **ERC-8004** for public per-agent identity metadata
- **ENS** for optional public swarm / organization naming and discovery

## Current architecture

### Swarm contract
The SoulVault swarm contract is responsible for:
- join requests and approvals
- member removal
- epoch rotation references
- historical key grant references
- per-member backup file mappings
- verified event-driven messaging metadata
- coordinated backup trigger events
- agent manifest references

Primary interface:
- `contracts/ISoulVaultSwarm.sol`

### Agent identity
SoulVault does **not** define a custom agent identity contract.

Instead:
- agent identity uses **ERC-8004**
- SoulVault integrates through a small adapter surface

Primary interface:
- `contracts/IERC8004AgentRegistryAdapter.sol`

This split is intentional:
- **swarm membership** is a SoulVault concern
- **public agent identity** is an ERC-8004 concern

### Swarm / organization identity
SoulVault may also use **ENS** as an optional naming and discovery layer for swarms or organizations.

Recommended layering:
- **SoulVault swarm contract** = authoritative private coordination + membership
- **ERC-8004** = public per-agent identity
- **ENS** = optional public organization/swarm namespace and discoverability

Examples:
- organization root: `acme.eth`
- swarm: `ops.acme.eth`
- agent subnames: `rusty.ops.acme.eth`

Recommended ENS terminology:
- **organization** = the root ENS/app-owned namespace (for example `acme.eth`)
- **swarm** = a first-level subdomain under the organization (for example `ops.acme.eth`)
- **agent** = an optional deeper subdomain beneath the swarm or organization (for example `rusty.ops.acme.eth`)

ENS is **not** the source of truth for membership or epoch access. It is the public face / namespace layer.

For SoulVault-on-0G, ENS can point into the 0G world via text records / multichain address records while living on Ethereum-facing ENS infrastructure. For development, default ETH/ENS config targets Sepolia rather than mainnet. The source code can stay largely chain-agnostic because both sides are EVM-shaped; the main operational difference is which RPC + chain ID the CLI is talking to.

Current Sepolia ENS defaults for CLI config:
- Registry: `0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e`
- Base Registrar: `0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85`
- ETH Registrar Controller: `0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968`
- Public Resolver: `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`
- Universal Resolver: `0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`

## Storage model

SoulVault now uses **0G Storage** as the canonical remote storage layer for encrypted memories/backups.

### Backup flow
1. agent resolves its local harness backup command
2. agent creates deterministic backup bundle(s)
3. bundle is encrypted with current `K_epoch`
4. ciphertext is uploaded to 0G Storage
5. CLI captures:
   - `storageLocator`
   - `publishTxHash`
   - `manifestHash`
   - `merkleRoot`
6. CLI writes a per-member file mapping into each swarm contract the agent belongs to

### Option B file mapping model
SoulVault uses the explicit per-member file mapping approach.

Core method:
- `updateMemberFileMapping(member, storageLocator, merkleRoot, publishTxHash, manifestHash, epoch)`

Core event:
- `MemberFileMappingUpdated(member, epoch, storageLocator, merkleRoot, publishTxHash, manifestHash, by)`

## Encryption model

### Epoch key
Each swarm epoch has one shared content key:
- `K_epoch`

In MVP:
- `K_epoch` encrypts backups
- `K_epoch` also encrypts message payloads
- wrapped epoch-key bundles are stored offchain
- symmetric keys are never stored onchain

### Messaging
SoulVault includes a unified messaging event protocol:
- onchain metadata
- offchain payload reference
- audience inferred in MVP from payload form + `to`

Message classes:
- **public**: plaintext/public payload + `to = address(0)`
- **swarm**: encrypted payload + `to = address(0)`
- **DM**: encrypted payload + `to = recipient`

Swarm messages use the current `K_epoch`. DMs use recipient-specific public-key encryption.

Core method:
- `postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)`

Core event:
- `AgentMessagePosted(from, to, topic, seq, epoch, payloadRef, payloadHash, ttl, timestamp)`

Spec:
- `contracts/MESSAGE_PROTOCOL.md`

## Event-driven backup coordination

Backups are now intended to be **event-driven first**.

A coordinator/owner can emit:
- `requestBackup(epoch, reason, targetRef, deadline)`

Which emits:
- `BackupRequested(requestedBy, epoch, reason, targetRef, deadline, timestamp)`

Listening agents respond by:
1. validating the request
2. running local backup flow
3. uploading encrypted artifacts to 0G
4. publishing `MemberFileMappingUpdated`

Cron / `HEARTBEAT.md` can still exist, but as fallback rather than primary coordination.

## CLI surface

The CLI is converging on an **entity-first** model.

### Organization operations
- `soulvault organization create`
- `soulvault organization list`
- `soulvault organization use`
- `soulvault organization status`
- `soulvault organization register-ens`
- `soulvault organization update-metadata`
- `soulvault organization fund-agent`
- `soulvault organization fund-swarm`

### Swarm operations
- `soulvault swarm create`
- `soulvault swarm list`
- `soulvault swarm use <name>`
- `soulvault swarm status`
- `soulvault join request`
- `soulvault join approve <requestId>`
- `soulvault join reject <requestId>`
- `soulvault join cancel <requestId>`
- `soulvault member show <address>`
- `soulvault member remove <address>`
- `soulvault epoch rotate`
- `soulvault keygrant --member <address> --from-epoch <N>`

### Agent operations
- `soulvault agent create`
- `soulvault agent status`
- `soulvault agent register`
- `soulvault agent update`
- `soulvault agent show`
- `soulvault agent render-agenturi`

### Signer model
SoulVault should infer signer role by command family:
- **admin signer** for privileged organization/swarm administration (`organization register-ens`, funding actions, `join approve`, `epoch rotate`, etc.)
- **agent signer** for autonomous runtime and public-agent actions (`agent register`, `backup push`, `storage publish`, agent-side join request)

A Ledger is best treated as a backend for the admin signer role, not as a special onchain role.

### Helper operations
- `soulvault backup request`
- `soulvault backup push`
- `soulvault backup show`
- `soulvault restore pull`
- `soulvault storage publish`
- `soulvault storage fetch <locator>`
- `soulvault manifest update`
- `soulvault msg post`
- `soulvault events watch`

Legacy `identity ...` commands may remain temporarily as compatibility aliases, but `agent ...` is the preferred public surface.

Detailed CLI docs:
- `cli/COMMANDS.md`
- `cli/WORKFLOWS.md`

## Repo layout

- `contracts/`
  - `ISoulVaultSwarm.sol`
  - `IERC8004AgentRegistryAdapter.sol`
  - contract specs and protocol notes
- `cli/`
  - command and workflow specs
- `skills/`
  - repo-local SoulVault skill package for agents
- `docs/`
  - architecture, protocol, roadmap, pitch, glossary, and implementation notes

## Agent skill

A repo-local skill package now exists at:
- `skills/soulvault/SKILL.md`

It teaches agents how to:
- use the SoulVault CLI
- respond to swarm events
- handle backup triggers
- work with ERC-8004 identity flows

Supporting references:
- `skills/soulvault/references/commands.md`
- `skills/soulvault/references/events.md`

## Key specs

- `contracts/ISoulVaultSwarm.sol`
- `contracts/IERC8004AgentRegistryAdapter.sol`
- `contracts/SWARM_CONTRACT_SPEC.md`
- `contracts/ERC8004_INTEGRATION_SPEC.md`
- `contracts/MESSAGE_PROTOCOL.md`
- `docs/protocol-v0.1.md`
- `docs/architecture.md`
- `docs/technologies.md`
- `docs/cli-state-model.md`

## Status

This repo now contains:
- implementation-facing contract interface specs
- CLI command/workflow specs
- event-driven backup coordination design
- ERC-8004 integration adapter spec
- repo-local skill packaging for agent use

Implementation stubs for the actual Solidity contract and TypeScript CLI handlers are the next logical step.