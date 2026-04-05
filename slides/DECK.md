---
marp: true
theme: default
paginate: true
title: SoulVault
---

# SoulVault

## Encrypted Continuity + Coordination for Agent Swarms

![bg right:30% 60%](media/hero-logo-w.png)

> Agents are good at acting, bad at surviving restarts, handoffs, and multi-agent coordination.

---

# Problem

- Agent memory and persona state are **ephemeral** — lost on infra resets
- Shared state between agents is ad hoc and uncoordinated
- Backups are not triggered, verified, or encrypted by default
- Identity and permissions across agents are fuzzy
- Multi-agent systems need **shared encrypted state** and **verifiable coordination**

**Today:** prompt + runtime
**Missing:** a swarm ops layer

---

# What SoulVault Is

`SoulVault = swarm coordination protocol + encrypted persistence layer`

- **Onchain swarm contract** on ![h:28](media/0G-Logo-Purple_Hero.png) 0G Galileo for membership, epochs, backup triggers, and messages
- **Encrypted 0G Storage** for artifacts and envelopes
- **ERC-8004 +** ![h:28](media/ens-icon-blue.png) **ENS** on Sepolia for public identity and naming
- **TypeScript CLI** for operators and agents
- **`sync`** bootstraps org/swarm profiles from ENS on any new machine — no shared filesystem needed

---

# Core Model

```
Organization  →  Swarm  →  Agent
```

- **Organization** = namespace / admin boundary (ENS root name)
- **Swarm** = one contract, one member set, one epoch-key lineage
- **Agent** = wallet + local runtime + optional public identity

Important distinction:
- **Org/swarm owner** = admin / operator role
- **Agent** = runtime / member role

---

# Security Model

![bg right:40% 90%](media/security-flow-key-wrapping.png)

- Human root of trust for first join
- Epoch content key model (`K_epoch`) with rotation on join/kick
- Key bundles wrapped per member pubkey — **no symmetric keys onchain**
- Group messages: AES-256-GCM with `K_epoch` + AAD binding
- DMs: ephemeral ECDH to recipient pubkey
- Per-member file mappings onchain
- Hash verification at restore

`contract = authority` · `0G = encrypted payload layer` · `local machine = plaintext boundary`

---

# Why Event-Driven Matters

- Owner emits `BackupRequested` via contract
- Agents **watch events** and respond automatically
- Members publish encrypted backups and file mappings
- Restore is **verifiable**, not hand-wavy

This is not just storage — it is **coordination through contract events**.

Key events: `JoinRequested` · `JoinApproved` · `EpochRotated` · `BackupRequested` · `MemberFileMappingUpdated` · `AgentMessagePosted`

---

# Architecture

**Two-lane design:**

| Lane | Chain | Purpose |
|------|-------|---------|
| ![h:24](media/0G-Logo-Purple_Hero.png) **Ops** | 0G Galileo (16602) | Swarm contract, epochs, messages, backups |
| ![h:24](media/ens-icon-blue.png) **Identity** | Sepolia (11155111) | ENS naming + ERC-8004 agent registry |

**Signer split:**
- ![h:24](media/LEDGER-WORDMARK-BLACK-CMYK.png) (cold) → governance, admin signing, ENS registration
- **Hot key** → agent runtime autonomy

Single wallet drives both lanes; CLI routes automatically.

---

# Why ![h:50](media/0G-Logo-Purple_Hero.png) 0G

- Backups, epoch bundles, and message envelopes are too large for pure onchain storage
- 0G lets the contract hold **coordination truth** while storage holds **encrypted artifacts**
- Verifiable without forcing all data onchain — contract stores rootHash pointers
- Upload via `@0gfoundation/0g-ts-sdk`: `ZgFile`, `MemData`, `Indexer`

`0G gives us the ops lane: event coordination now, richer storage/compute patterns later.`

---

# Why ![h:50](media/ens-icon-blue.png) ENS + ERC-8004

- **ENS** gives human-readable naming for orgs and swarms (`soulvault.eth`, `ops.soulvault.eth`)
- **ERC-8004** gives public agent identity with structured metadata
- Together they create a **discovery layer** without making discovery the source of truth
- Membership still comes from the swarm contract; identity is optional but useful
- ENS text records enable `sync` — agents bootstrap state from on-chain data alone

`The swarm contract decides who is in; ENS + ERC-8004 help others find and understand those agents.`

---

# Why ![h:50](media/LEDGER-WORDMARK-BLACK-CMYK.png)

- First integration of Ledger **Device Management Kit** (DMK) for agent swarm governance
- Hardware root-of-trust signs join approvals, epoch rotations, ENS registrations, and messages
- Novel workarounds shipped:
  - Stripped clear-sign context APDUs for unsupported contract selectors
  - Downgraded EIP-1559 → legacy type-0 for Ledger Ethereum app compatibility
  - Auto-sync bootstraps local swarm state from ENS the moment the device connects
- Private keys **never** leave the device

---

# Messaging Layer

Three modes, one transport:

| Mode | Encryption | Audience |
|------|-----------|----------|
| **Public broadcast** | None (plaintext envelope) | Anyone watching |
| **Group encrypted** | AES-256-GCM with `K_epoch` + AAD | Swarm members |
| **Private DM** | Ephemeral ECDH to recipient pubkey | One recipient |

All payloads uploaded to ![h:24](media/0G-Logo-Purple_Hero.png) 0G Storage; contract stores `payloadRef` + `payloadHash`.

`Shared memory is not enough; swarms also need a native transport layer.`

---

# Demo Flow

![bg right:50% 100%](dist/media/soulvault-short.mp4)

1. Create org + deploy swarm contract
2. Agent requests join (submits pubkey)
3. Owner approves (Ledger-signed)
4. Rotate epoch — `K_epoch` bundle to 0G
5. Trigger backup — agents auto-respond

6. Encrypted group message — decrypt + verify

---

# CLI + SKILL.md

![bg right:45% 95%](media/cli-status-dashboard.png)

- CLI gives a stable, testable interface for humans **right now**
- `SKILL.md` gives agents structured operating context, workflows, and guardrails
- Together they act as an intermediate layer between raw code and future agent-native interfaces

`CLI for execution, SKILL.md for agent understanding, MCP later.`

Not the final interface — the right hackathon interface.

---

# Competitive Landscape

**What exists:**
- Agent coordination frameworks
- DAO / multisig governance
- Decentralized storage and encrypted backup tools

**What is missing:**
- End-to-end agent identity continuity for memory/state
- Join governance + encrypted restore in one lifecycle
- Native multi-swarm messaging with epoch-bound encryption

**SoulVault contribution:**
- Encrypted continuity · Onchain admissions · Event-driven swarm messaging

---

# Future Ideas

- **Task coordination + validation:** SoulVault as coordination substrate for higher-level agent systems — task assignment, handoff, checkpointing via swarm messages + events
- **Policy engine:** automatic approvals, backup SLAs, rotation rules
- **Hosted watcher service:** for teams that don't want local daemons
- **Multi-swarm federation:** cross-swarm handoff and identity portability
- **dm3 interop:** ![h:24](media/ens-icon-blue.png) ENS naming + swarm messaging leave a clean surface for ENS-addressed messaging systems

`Application-specific agent systems on top, SoulVault underneath as the coordination + verification rail.`

---

# Why This Matters

> LLMs gave us agent behavior. SoulVault gives agents infrastructure — membership, encrypted memory, and a coordination bus.

- **Agent continuity** — survive restarts, migrations, infra resets
- **Composable coordination primitive** — one contract per swarm, many swarms per org
- **Verified messaging** — contract events as the source of truth
- **Useful today** — for autonomous research teams, dev swarms, multi-bot ops, long-running copilots

---

# Ask / Next Steps

- Partner integrations (agent frameworks, MCP adapters)
- Security review of crypto pipeline
- Production hardening + hosted infrastructure
- Richer SDKs beyond CLI

> Agent frameworks are great at thinking. SoulVault makes them survivable, recoverable, and governable as a swarm.
