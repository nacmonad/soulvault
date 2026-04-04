# Story 01 — Browse SoulVault organizations, swarms, and member identities

This story is a lightweight operator/demo flow.

Goal:
- list known organizations
- inspect the basic organization metadata / ENS state
- list known swarms
- select the active swarm
- inspect the public identities of the swarm's members

This is a strong demo story because it shows the relationship between:
- the organization namespace
- the swarm namespace
- the members participating in that swarm
- the public identity layer associated with those members

---

## 1) List organizations
```bash
soulvault organization list
```

Shows the locally known organization profiles.

---

## 2) Show organization metadata
```bash
soulvault organization status --organization soulvault.eth
```

Shows:
- local organization profile
- ENS root name
- visibility posture
- owner defaults
- registration/binding status

---

## 3) List swarms
```bash
soulvault swarm list
```

Shows the locally known swarm profiles.

---

## 4) Select the swarm
```bash
soulvault swarm use ops
```

Makes `ops` the active swarm context.

---

## 5) Inspect member public identities
```bash
soulvault swarm member-identities --swarm ops
```

Intended MVP behavior:
- resolve member wallets from the swarm contract
- look up ERC-8004 identities by wallet on Sepolia
- merge any known local profile data
- render the member's public identity summary

Expected useful fields:
- member wallet
- active status
- joined epoch
- ERC-8004 registry address
- ERC-8004 agent id
- public agent name / harness if available
- raw or shortened `agentURI` reference

---

## Notes
- `swarm member-identities` is a particularly good demo command because it bridges:
  - private swarm membership
  - public identity/discovery
- ENS/public manifest enrichment can remain optional later. The first sound MVP approach is:
  1. swarm state -> member wallet
  2. wallet -> ERC-8004 registry lookup
