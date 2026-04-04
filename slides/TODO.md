# SoulVault deck outline

## Positioning

SoulVault is an event-driven coordination and continuity layer for agent swarms.

Core claim:
- agents need shared continuity, not just chat
- swarms need encrypted memory, membership, and recovery
- SoulVault gives them a contract-driven control plane plus encrypted offchain state

Good opening line:
- "Agents are great at acting, bad at surviving restarts, handoffs, and multi-agent coordination."

## Suggested slide flow

### 1. Title
- `SoulVault`
- subtitle: `Encrypted continuity + coordination for agent swarms`
- one-line hook: `If agents can collaborate, they also need memory, membership, messaging, and recovery.`

### 2. Problem
- agent sessions are ephemeral
- shared state is usually ad hoc
- backups are not coordinated
- identity and permissions are fuzzy
- multi-agent systems need a real control plane

Possible framing:
- today: "prompt + runtime"
- missing: "swarm ops layer"

### 3. What SoulVault Is
- onchain swarm contract on 0G for membership, epochs, backup triggers, and messages
- encrypted 0G storage for artifacts and envelopes
- optional ERC-8004 + ENS on Sepolia for public identity and naming
- local CLI for operators and agents

Short line:
- `SoulVault = swarm control plane + encrypted persistence layer`

### 4. Core Model
- `Organization -> Swarm -> Agent`
- organization = namespace / admin boundary
- swarm = one contract, one member set, one epoch-key lineage
- agent = wallet + local runtime + optional public identity

Important distinction:
- org/swarm owner is the admin/operator role
- agent user is the runtime/member role

### 5. Why Event-Driven Matters
- owner emits `BackupRequested`
- agents watch events and respond automatically
- members publish encrypted backups and file mappings
- restore is verifiable, not hand-wavy

Message:
- this is not just storage
- it is coordination through contract events

### 6. Crypto / Trust Model
- backups encrypted with `K_epoch`
- epoch keys wrapped per member pubkey
- no symmetric keys onchain
- group messages use shared epoch access
- DMs use recipient pubkey encryption

Keep this visual, not academic:
- `contract = authority`
- `0G = encrypted payload layer`
- `local machine = plaintext boundary`

### 7. Demo Story
- create org + swarm
- agent joins
- owner approves
- rotate epoch
- trigger backup
- agent auto-responds
- restore and verify

Use the stories as demo anchors:
- `story00` bootstrap
- `story04` backup flow
- `story05` or `story06` messaging

### 8. Messaging Layer
- public broadcast
- group-encrypted coordination
- private direct messages

Pitch line:
- `shared memory is not enough; swarms also need a native transport layer`

### 9. Why Open Source / Who It Helps
- lets agent frameworks plug into a common continuity layer
- makes swarm coordination inspectable and composable
- useful for autonomous dev agents, research teams, multi-bot ops, long-running copilots
- good open-source surface: CLI, event watchers, storage adapters, identity adapters

Avoid biography. Make this the "why now / why this matters" slide.

### 10. Architecture Slide
- two lanes:
- ops lane on 0G Galileo
- identity lane on Sepolia
- single signer today, but separable roles later

Simple visual:
- `Ops chain: swarm contract, epochs, messages, backups`
- `Identity chain: ENS + ERC-8004`

### 10.5 Why This Stack

#### Why 0G
- we needed more than a chain; we needed contract events plus payload storage
- backups, epoch bundles, and message envelopes are too large / too dynamic for pure onchain storage
- 0G lets the contract hold the coordination truth while storage holds encrypted artifacts
- this keeps the system verifiable without forcing all data onchain
- future-facing angle: storage today, compute later

Pitch line:
- `0G gives us the ops lane: event coordination now, richer storage/compute patterns later`

#### Why ENS + ERC-8004
- ENS gives human-readable naming for organizations and swarms
- ERC-8004 gives public agent identity and service metadata
- together they create a discovery layer without making discovery the source of truth
- membership still comes from the swarm contract; identity is optional but useful

Pitch line:
- `the swarm contract decides who is in; ENS + ERC-8004 help others find and understand those agents`

Good nuance:
- ENS is naming / routing / discovery
- ERC-8004 is structured agent metadata
- SoulVault does not require public registration to function

#### DM3 angle
- if you mention `dm3`, frame it as compatibility / future direction, not a current dependency
- ENS-style identity and address discovery fit well with wallet-native messaging systems
- SoulVault already has its own message transport model, but ENS-based discovery could make interop cleaner later

Safe line:
- `This also leaves room for future interoperability with ENS-addressed messaging systems such as dm3.`

### 10.6 Why Ledger / Admin Separation

- the risky actions are admin actions, not normal agent runtime actions
- approving joins, rotating epochs, and triggering backup waves should be treated like governance / ops approvals
- those should be signed by an org or swarm admin wallet, ideally Ledger-backed
- the agent itself can still run with a hot key for day-to-day participation

Core distinction:
- `organization owner` = long-lived admin / governance authority
- `swarm owner` = operational admin for a given swarm
- `agent user` = runtime actor participating in the swarm

Pitch line:
- `Ledger locks down the approval plane without slowing down the execution plane`

Good concrete examples:
- approve join requests with Ledger
- rotate epoch with Ledger
- emit `BackupRequested` with Ledger
- keep agent message posting / backup response on a separate hot runtime key

### 11. Future Ideas

#### Ledger integration
- split `organization/swarm owner` from `agent user`
- owner/admin signs privileged actions with Ledger
- agent runtime uses a hot key for day-to-day participation
- better model for real deployments: cold governance + hot operations
- reduce or eliminate flows that still require blind / non-clear signing
- improve contract call presentation so admin approvals feel safer and less opaque on-device

Pitch it as:
- `human admin security without breaking agent autonomy`

#### API layer + cache layer
- index events and storage refs into a queryable API
- cache member state, latest epoch, backup status, message metadata
- make dashboards, automation, and hosted control planes easy
- reduce repeated chain scans and 0G fetches

Pitch it as:
- `from raw protocol to usable platform`

#### Good third future idea options
- policy engine for automatic approvals / backup SLAs / rotation rules
- hosted watcher service for teams that do not want to run local daemons
- multi-swarm federation and cross-swarm handoff
- richer SDKs for agent frameworks beyond the CLI

### 12. Close / Ask
- SoulVault is early, but the shape is clear:
- membership
- encrypted continuity
- event-driven automation
- agent identity
- swarm-native messaging

Possible close:
- `We think agent systems will need something like Kubernetes for continuity and coordination. SoulVault is an early version of that layer.`

## Recommended deck size

For a hackathon:
- 7 slides if very tight: 1, 2, 3, 5, 7, 11, 12
- 10 slides if normal: 1 through 10, then 12

## Notes on tone

- keep it product-first, not biography-first
- avoid over-explaining crypto
- emphasize continuity, recovery, and coordination
- treat backups + messaging + identity as one system, not three random features

## Optional stronger framing

Alternative title:
- `SoulVault: persistence and coordination for autonomous swarms`

Alternative problem statement:
- `LLMs gave us agent behavior. We still need agent infrastructure.`
