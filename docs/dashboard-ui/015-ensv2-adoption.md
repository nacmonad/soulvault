# ENSv2 adoption: agents as namespaces on the beta registry

## Parent

[011-ens-native-state.md](./011-ens-native-state.md) — ENS-native state epic

## Context — why this ticket exists

ETHOnline 2026 ENS track (ethglobal.com/events/ethonline2026): **Best Use of
ENSv2 — $4,500** (main track) and **Best Integration of ENSv2 into an Existing
Project — $500** (Continuity track). SoulVault targets three tracks this event —
Ledger (DMK device signing), World (AgentKit human-verification gating), and
ENS — and ENSv2 is the third.

SoulVault is currently **ENSv1**: legacy Registry (`0x0000…C2E074eC69A0dFb2997BA6C7d2e1e`),
PublicResolver (`0xE99638…BBE49b5`), `ETHRegistrarController` + `NameWrapper`
(with post-registration 2LD unwrap for our subdomain workflow). ENSv2 beta is
live on the same chain we already use for identity (Sepolia), so adoption is a
lane upgrade, not a re-architecture.

## Why ENSv2 is a structural fit (not a reskin)

| ENSv2 feature | Replaces / unlocks in SoulVault |
|---|---|
| **Enhanced Access Control** (role-based, record-scoped — e.g. "this account may edit only certain text records on a name") | Our `requireOrgOwnership` gate means one org owner signs *every* ENS write. EAC delegation lets treasury-bots, swarm admins, and agents write their own scoped records without holding the org key. This is the *delegation* answer to ticket 013's prompt-count problem — delegate once instead of batching everything through one signer |
| **Deploy your own subname registry** | `soulvault.swarms` CBOR index + manual `setSubnodeRecord` becomes a real on-chain registry where swarm subnames under `<org>.eth` are managed by our rules |
| **Permissioned Resolver per subname** | Swarm/agent subnames own their records outright instead of borrowing the org's resolver |
| **Wildcard resolution off the parent resolver** | Resolve swarm and agent subnames without per-node resolver setup |
| **Expiring / revocable subnames** | Epoch membership as a primitive: agent subnames that expire with the epoch, revocable on kick. "Forever names" available where wanted |
| **ENSIP-25 / ENSIP-26** (agent name verification, agent text records) | Standardizes what we do ad-hoc today with `soulvault.*` records beside ERC-8004 identity |

The hackathon framing also matters: ENSv2 features must be **central, not
cosmetic** (main track). Agents-as-namespaces — each swarm/agent with its own
subname, its own permissions, expiring with epoch membership — is the
load-bearing story, and it is genuinely what epic 011 already points at.

## What to build

### Phase A — ENSv2 spike (risk-burn first)

- Spike branch: deploy the ENSv2 permissioned-registry + permissioned-resolver
  contracts per the contract-developers guide on Sepolia; replicate the
  bootstrap flow for a test org (`org create` → name registered under v2).
- Verify our load-bearing read/write primitives against v2 resolvers:
  ENSIP-11 multichain `addr(node, coinType)` (treasury discovery is built on
  it), `setText` upsert patterns, CBOR `soulvault.swarms` round-trip.
- Deliverable: a written spike note (docs/) with contract addresses, gaps, and
  a go/no-go on the migration path.

### Phase B — Swarm registry on ENSv2

- Deploy a SoulVault subname registry per org under v2 (or use the shared
  registry + namespace aliasing, per spike findings).
- `swarm create` provisions a subname in the org's registry instead of
  hand-rolled `setSubnodeRecord`; visibility modes map to record visibility.
- EAC roles: `swarm-admin` may create/list subnames; `treasury-writer` may
  update the `soulvault.treasuries` record; the org owner key stays cold.

### Phase C — Agents as namespaces (hackathon centerpiece)

- Agent identity = ENSv2 subname + Permissioned Resolver, aligned with
  ENSIP-25 (name verification) and ENSIP-26 (agent text records), cross-linked
  to the existing ERC-8004 registration.
- Epoch rotation grants/revokes agent subnames: join → subname minted with
  epoch expiry; kick/leave → revoked. Membership becomes resolvable identity.
- Dashboard + CLI read/write paths updated; v1 records remain readable during
  migration (dual-read, v2-write).

## Explicit risk register

- **Beta volatility**: registry/resolver addresses and tooling may move; viem
  may lack first-class support for EAC — expect hand-written ABIs (we already
  hand-roll resolver ABIs, so this is familiar ground).
- **Record-format continuity**: the `soulvault.treasuries` JSON record,
  `soulvault.swarms` CBOR record, and ENSIP-11 addr slots must survive the
  migration byte-identically (011 principle 4). Write-side cutover is the
  only visible change.
- **Prize-rule hygiene**: main track wants ENSv2 central; Continuity track
  wants documented pre-existing work. Decide the track per the state of the
  repo at event start — if Phases A–B land pre-event, the Continuity track
  ($500) is the honest fit; if the epoch-subname work (Phase C) lands *during*
  the event, the main track ($4,500) is defensible.

## Acceptance criteria

- [ ] Spike note exists with v2 contract addresses and a verified ENSIP-11
      multicoin read/write against a v2 resolver.
- [ ] One org's swarm tree is provisioned under a SoulVault subname registry
      on ENSv2 Sepolia and resolvable via wildcard from the parent.
- [ ] An EAC role can write scoped records without the org owner key
      (demonstrated: treasury-bot updates `soulvault.treasuries`).
- [ ] Agent subnames mint on join-approval, expire with the epoch, revoke on
      kick, and resolve in the dashboard.
- [ ] ENSIP-25/26 record alignment documented in
      `skills/soulvault/references/` alongside the ERC-8004 mapping.

## Blocked by

None for Phase A (spike). Phases B–C build on this branch's
`soulvault.treasuries` record work. Relationship to
[013-ens-write-batching.md](./013-ens-write-batching.md): EAC delegation and
multicall batching are **alternative** prompt-reduction strategies — if EAC
lands, 013 shrinks to batching only the writes that still share one signer.
