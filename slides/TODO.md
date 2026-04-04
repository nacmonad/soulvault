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
- multi-agent systems need shared encrypted state and verifiable coordination

Possible framing:
- today: "prompt + runtime"
- missing: "swarm ops layer"

### 3. What SoulVault Is
- onchain swarm contract on 0G for membership, epochs, backup triggers, and messages
- encrypted 0G storage for artifacts and envelopes
- optional ERC-8004 + ENS on Sepolia for public identity and naming
- local CLI for operators and agents
- `sync` lets agents bootstrap org/swarm profiles from ENS on any new machine — no shared filesystem needed

Short line:
- `SoulVault = swarm coordination protocol + encrypted persistence layer`

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
- Ledger-signed admin approval
- rotate epoch
- post encrypted group message
- decrypt and verify
- trigger backup, agent auto-responds

This shows the full stack in one pass: governance, crypto, messaging, and coordination.

Use the stories as demo anchors:
- `story00` bootstrap
- `story07` Ledger signing (shipped, not future)
- `story05` or `story06` messaging
- `story04` backup flow

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

### 10. Why CLI + SKILL.md
- I did not have enough time to build a full MCP integration for the hackathon
- the CLI gives a stable, testable interface for humans right now
- `SKILL.md` gives agents structured operating context, workflows, and guardrails right now
- together they act as an intermediate layer between raw code and future agent-native interfaces
- this is useful because we are now building software for both humans and agents

Pitch line:
- `CLI for execution, SKILL.md for agent understanding, MCP later`

Good framing:
- not the final interface
- the right hackathon interface
- already good enough for both operator workflows and agent-assisted use

### 11. Architecture Slide
- two lanes:
- ops lane on 0G Galileo
- identity lane on Sepolia
- Ledger for admin signing (shipped), hot key for agent runtime

Simple visual:
- `Ops chain: swarm contract, epochs, messages, backups`
- `Identity chain: ENS + ERC-8004`
- `Signer split: Ledger (cold governance) / hot key (agent autonomy)`

### 11.5 Why This Stack

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

#### DM3 / ENS messaging interop
- SoulVault already has its own message transport (public, group, DM via `postMessage`)
- ENS-style identity and address discovery fit naturally with wallet-native messaging systems like dm3
- frame as compatibility / future direction, not a current dependency
- worth a visible bullet on the architecture slide if ENS/dm3 judges are in the room

Pitch line:
- `SoulVault's ENS naming + swarm messaging leave a clean surface for interop with ENS-addressed messaging systems like dm3.`

### 12. Future Ideas

#### Task coordination + validation systems
- SoulVault can become the coordination substrate for higher-level agent systems
- use swarm messages + events for task assignment, handoff, checkpointing, and completion
- use encrypted artifacts + onchain references for validation inputs, outputs, and audit trails
- useful for systems like `Proof of Claw`, where another team wants shared coordination plus verifiable result publication
- SoulVault does not need to own the application logic; it can provide the continuity, membership, and evidence layer underneath

Pitch it as:
- `application-specific agent systems on top, SoulVault underneath as the coordination + verification rail`

#### Good third future idea options
- policy engine for automatic approvals / backup SLAs / rotation rules
- hosted watcher service for teams that do not want to run local daemons
- multi-swarm federation and cross-swarm handoff
- richer SDKs for agent frameworks beyond the CLI

### 13. Close / Ask
- SoulVault is early, but the shape is clear:
- membership
- encrypted continuity
- event-driven automation
- agent identity
- swarm-native messaging

Possible close:
- `LLMs gave us agent behavior. SoulVault gives agents infrastructure — membership, encrypted memory, and a coordination bus.`

Alternative close:
- `Agent frameworks are great at thinking. SoulVault makes them survivable, recoverable, and governable as a swarm.`

## Recommended deck size

For a hackathon:
- 7 slides if very tight: 1, 2, 3, 5, 7, 12, 13
- 10 slides if normal: 1 through 11, then 13

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
