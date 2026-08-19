# SoulVault CLI State Model

## Purpose
Define the local state model and command/entity boundaries for the SoulVault CLI before deeper implementation.

This document is intended to make the CLI implementation unambiguous around:
- what `.env` is allowed to hold
- what belongs in local SoulVault state
- how organizations, swarms, and agents relate
- how active context switching should work

---

## 1) Primary CLI entities
SoulVault should be designed around three top-level nouns:

- `organization`
- `swarm`
- `agent`

Helper surfaces may still exist for operational tasks:
- `backup`
- `restore`
- `storage`
- `events`

But lifecycle ownership should stay entity-first:
- **organization** owns ENS root identity, org metadata, treasury/funding defaults
- **swarm** owns contract/deployment/membership context
- **agent** owns local runtime identity, wallet usage, and public agent registration

---

## 2) Entity hierarchy
Recommended hierarchy:

1. **Organization**
   - root public namespace
   - optional ENS root name
   - owner/treasury context
   - publication/discoverability posture
   - zero or more swarms

2. **Swarm**
   - belongs to one organization
   - has one authoritative SoulVault swarm contract
   - has one primary 0G chain/RPC context
   - has its own independent `K_epoch` lineage
   - may have an ENS subdomain under the organization root
   - has zero or more member agents

3. **Agent**
   - local runtime / local wallet
   - may join zero or more swarms
   - may register one ERC-8004 identity
   - may optionally have an ENS subname beneath a swarm or organization name

### Naming model
- organization root: `soulvault.eth`
- swarm subdomain: `ops.soulvault.eth`
- agent subdomain: `rusty.ops.soulvault.eth`

---

## 3) What `.env` is for
`.env` should hold **defaults**, not the canonical definition of organizations or swarms.

Good `.env` content:
- default signer settings for distinct signer roles
- default local private key / mnemonic for the current agent runtime
- optional admin signer defaults (including Ledger-oriented settings later)
- default 0G RPC / chain ID
- default ETH/ENS RPC / chain ID
- ENS contract addresses
- optional default harness/runtime values
- test/dev constants like `SOULVAULT_TEST_K_EPOCH`

Bad `.env` content:
- the only record of all organizations
- the only record of all swarms
- the only record of active org/swarm relationships
- long-lived structured business state

### Design rule
`.env` is bootstrap configuration.
`~/.soulvault/` is the canonical local state store.

### Signer roles
SoulVault should distinguish between at least two signer roles:
- **agent signer** — autonomous runtime signer used for agent-driven operations
- **admin signer** — human-controlled owner/treasury signer used for privileged organization/swarm administration

Recommended command inference model:
- `organization register-ens`, `organization fund-agent`, `organization fund-swarm`, `join approve`, `member remove`, `epoch rotate`, `keygrant` => use **admin signer** by default
- `agent register`, `backup push`, `storage publish`, agent-side join request => use **agent signer** by default

Ledger is a signer backend for the admin signer role, not an onchain role.

---

## 4) Local filesystem model
Recommended layout:

```text
~/.soulvault/
  config.json
  agent.json
  last-backup.json
  organizations/
    soulvault.json
  swarms/
    ops.json
    .archived/
      <slug>.json          (archived swarms from `swarm remove`)
  treasuries/
    <orgSlug>.json         (treasury profiles — contract address, ENS binding, etc.)
  keys/
    ...
```

### `config.json`
Stores active/default pointers and non-secret operator preferences.

Recommended fields:
- `activeOrganization`
- `activeSwarm`
- `activeAddress`
- default RPC lanes
- preferred harness/runtime

### `agent.json`
Stores the local agent profile.

Recommended fields:
- name
- address
- public key
- harness
- backup command
- optional ERC-8004 identity metadata

`backup command` should mean the literal artifact-producing command that the agent actually runs for that harness/runtime, not an invented abstraction label.

### `organizations/*.json`
Stores one local organization profile per known organization.

Recommended fields:
- local slug/name
- ENS root name
- visibility posture (`public`, `private`, `semi-private`)
- owner wallet / treasury defaults
- ETH/ENS RPC preferences (if overridden)
- linked swarm names

### `swarms/*.json`
Stores one local swarm profile per known swarm.

Recommended fields:
- local swarm name
- parent organization reference
- 0G chain ID / RPC
- contract address
- owner address
- optional ENS swarm name
- visibility posture

### `keys/`
Stores future encrypted keystore material, wrapped epoch key material, and related secret artifacts.

Recommended indexing model:
- keys should be stored per swarm, then per epoch
- organization does not imply one shared epoch key across all swarms
- the live MVP path now stores generated swarm epoch keys locally under this layout

Example:
```text
~/.soulvault/keys/
  ops/
    epoch-1.json
    epoch-2.json
  research/
    epoch-2.json
```

Example stored epoch key record:
```json
{
  "swarm": "ops",
  "epoch": 2,
  "keyHex": "0x...",
  "keyFingerprint": "...",
  "createdAt": "2026-04-04T14:20:12.217Z",
  "source": "generated"
}
```

---

## 5) Active context model
SoulVault should support **0..N organizations** and **0..N swarms** locally.

The CLI should not assume there is only one organization in `.env`.

Recommended context commands:
- `soulvault organization use <name|ens-name>`
- `soulvault swarm use <name>`

Resolution rules:
- if a command gets an explicit `--organization`, use it
- else fall back to `config.json.activeOrganization`
- if a command gets an explicit `--swarm`, use it
- else fall back to `config.json.activeSwarm`

---

## 6) Chain lane model
SoulVault uses two main EVM lanes in MVP:

### A) SoulVault swarm lane
Used for:
- swarm contract reads/writes
- joins
- approvals
- epoch rotation
- file mapping publication
- backup coordination

Signer guidance:
- agent-driven swarm actions generally use the **agent signer**
- privileged swarm administration generally uses the **admin signer**

Default target:
- 0G Galileo testnet
- chain ID `16602`

### B) ETH / ENS lane
Used for:
- ENS lookups
- ENS writes
- organization root naming
- swarm subdomain metadata
- future public agent subname management

Signer guidance:
- read-only ENS lookups can use provider-only access
- ENS writes should use the **admin signer** by default

Default target for dev/test:
- Sepolia
- chain ID `11155111`

### Design rule
The code can share common EVM abstractions, but the CLI/state model must keep these lanes explicit.

---

## 7) Funding model
Organization funding is a CLI/operator feature, not a SoulVault contract primitive.

### MVP funding surfaces
- `soulvault organization fund-agent`
- `soulvault organization fund-swarm`

These should:
- use the organization owner/treasury signer
- choose the correct chain lane (`0g` vs `eth`)
- send native gas token only in MVP
- record local history for visibility/audit

---

## 8) Command ownership model
### Organization commands own:
- create/list/use/status
- ENS root registration or binding
- ENS org metadata updates
- org-level funding actions
- default admin-signer-led organization actions

### Swarm commands own:
- create/list/use/status
- deployment/configuration metadata
- join/approve/reject/cancel
- membership inspection
- epoch/recovery operations tied to a specific swarm

### Agent commands own:
- local agent creation/status
- ERC-8004 public registration/update/show
- public agentURI rendering
- agent runtime metadata
- default agent-signer-led runtime/public identity actions

### Helper commands remain useful for:
- backup execution
- restore execution
- storage upload/download
- event watching

---

## 9) Implementation note
During scaffold phases, compatibility aliases are acceptable:
- `identity ...` may continue to exist temporarily

But the preferred UX should converge on:
- `soulvault organization ...`
- `soulvault swarm ...`
- `soulvault agent ...`

That keeps the CLI aligned with the actual system model instead of forcing users to memorize helper namespaces for core lifecycle actions.
