---
marp: true
theme: default
paginate: true
title: SoulVault
---

# SoulVault Deck

Format note:
- For hackathons, the most typical delivery is **Google Slides or PowerPoint exported to PDF**.
- A `.pptx` is fine, but the practical target is usually: easy to present live, easy to export, easy to submit.
- This markdown file is the clean source-of-truth for the deck content.

---

---

## Slide 1 — Title
**SoulVault**

**Encrypted continuity + coordination for agent swarms**

Hook:
- Agents are good at acting, bad at surviving restarts, handoffs, and multi-agent coordination.

Footer idea:
- 0G ops lane + ERC-8004/ENS identity lane + CLI control plane

---

---

## Slide 2 — Problem
**Agent systems still lack infrastructure**

Today:
- sessions are ephemeral
- shared state is ad hoc
- backups are uncoordinated
- identity and permissions are fuzzy
- multi-agent collaboration is hard to verify

What is missing:
- encrypted continuity
- explicit membership
- recoverable state
- event-driven coordination

Short line:
- LLMs gave us agent behavior. We still need agent infrastructure.

---

---

## Slide 3 — What SoulVault Is
**SoulVault = swarm coordination protocol + encrypted persistence layer**

SoulVault combines:
- a swarm contract on 0G for membership, epochs, backup triggers, and messaging
- encrypted 0G storage for artifacts, bundles, and envelopes
- ERC-8004 + ENS on Sepolia for public identity and naming
- a local CLI for operators and agents

Why it matters:
- not just backup
- not just identity
- not just messaging
- one system for survivable autonomous swarms

---

---

## Slide 4 — Core Model
**Organization → Swarm → Agent**

- **Organization** = namespace + admin boundary
- **Swarm** = one contract, one member set, one epoch-key lineage
- **Agent** = wallet + local runtime + optional public identity

Important distinction:
- admin/operator role manages org + swarm control plane
- runtime/member role executes agent workflows

Suggested visual:
- Org at top
- multiple swarms beneath
- agents under each swarm

---

---

## Slide 5 — Architecture
**Two lanes, one control plane**

Ops lane:
- 0G Galileo
- swarm contract
- backup requests
- epoch rotation
- messages
- file mappings

Identity lane:
- Sepolia
- ENS naming
- ERC-8004 public agent metadata

Signer split:
- Ledger = admin/governance signer
- hot wallet = autonomous agent runtime signer

Visual idea:
Owner/Ledger ↔ Swarm Contract ↔ SoulVault CLI ↔ 0G Storage ↔ Agent Runtime
and separate identity lane for ENS + ERC-8004

---

---

## Slide 6 — Security Model
**Encrypted by default, auditable by design**

- backups encrypted with `K_epoch`
- one `K_epoch` lineage per swarm
- epoch keys are wrapped per approved member
- no symmetric keys onchain
- contract stores coordination truth, not plaintext
- restore verifies hashes before trusting recovered state
- private keys are not included in backups

Plain-English framing:
- contract = authority
- 0G = ciphertext layer
- local machine = plaintext boundary

---

---

## Slide 7 — Demo Story
**What the demo shows**

1. create org + swarm
2. agent requests join
3. admin approves join
4. rotate swarm epoch
5. trigger backup with an event
6. agent watches `BackupRequested`
7. agent creates encrypted backup artifact and uploads to 0G
8. agent publishes `MemberFileMappingUpdated`
9. replacement machine can restore verified state

Anchors from repo stories:
- bootstrap / join / approve
- event-driven backup
- messaging
- Ledger signer

---

---

## Slide 8 — Messaging + Event-Driven Coordination
**This is not just storage**

SoulVault already supports:
- public broadcasts
- group-encrypted swarm coordination
- direct encrypted messages

Why event-driven matters:
- owner emits `BackupRequested`
- agents watch contract events
- members respond automatically
- coordination becomes observable and auditable

Pitch line:
- shared memory is not enough; swarms also need a native coordination bus

---

---

## Slide 9 — Why This Stack
**Why 0G + ENS + ERC-8004 + Ledger**

**Why 0G**
- contract events plus offchain encrypted artifacts
- good fit for backups, epoch bundles, message envelopes

**Why ENS + ERC-8004**
- human-readable discovery
- public agent metadata
- not the source of truth for membership

**Why Ledger in MVP**
- privileged admin actions are worth hardware signing
- better security story for swarm governance
- keeps autonomous backup response on the hot agent wallet

---

---

## Slide 10 — Competitive Gap
**What exists vs what is missing**

What exists:
- agent frameworks
- decentralized storage
- multisigs / governance tools
- messaging systems

What is missing:
- encrypted markdown continuity for agents
- join governance + encrypted restore in one lifecycle
- swarm-native event coordination for long-running agents
- OpenClaw-native multi-swarm control plane

SoulVault contribution:
- encrypted continuity + onchain admissions + event-driven swarm messaging

---

---

## Slide 11 — Why CLI + SKILL.md
**Hackathon-appropriate interface choice**

- full MCP integration would take longer than the hackathon window
- CLI gives a stable, testable operator surface now
- `SKILL.md` gives agents structured workflows and operating context now
- together they already support both human operators and agent-assisted execution

Pitch line:
- CLI for execution, SKILL.md for agent understanding, MCP later

---

---

## Slide 12 — Roadmap / Next Steps
**Near-term roadmap**

- `soulvault admin status` operator cockpit
- Ledger-first admin signer integration
- funding workflows for organizations/swarms
- production crypto path hardening
- richer ENS + public metadata
- quorum admissions and policy automation
- multi-swarm federation / task coordination

Optional future angle:
- SoulVault as the coordination substrate under higher-level agent systems

---

---

## Slide 13 — Close / Ask
**SoulVault gives agents infrastructure**

Not just agents that can think.
Agents that can:
- survive resets
- recover safely
- coordinate as a swarm
- carry governed encrypted continuity across machines

Close line option A:
- SoulVault makes agent swarms survivable, governable, and recoverable.

Close line option B:
- LLMs gave us agent behavior. SoulVault gives agents continuity, membership, and a coordination bus.

Ask:
- partner integrations
- security review
- hackathon feedback / pilot teams

---

---

## Presenter Notes

### Recommended deck length
- Tight demo: 7 slides → 1, 2, 3, 5, 7, 9, 13
- Standard hackathon deck: 10–12 slides

### Recommended actual submission format
- Build in Google Slides or PowerPoint
- Export PDF for submission
- Keep this markdown as the source script/content file

### Tone
- product-first, not biography-first
- avoid over-explaining crypto
- emphasize continuity, recovery, membership, and coordination as one coherent system
