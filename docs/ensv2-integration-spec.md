# ENSv2 Integration Spec — SoulVault → ETHGlobal Online 2026

Target prizes (https://ethglobal.com/events/ethonline2026/prizes#ens):

| Prize | Pool | Track | Fit |
|---|---|---|---|
| Best Use of ENSv2 | $4,500 | open | ✓ primary |
| Best Integration of ENSv2 into an Existing Project | $500 | Continuity only | ✓ we are a Continuity project |

Qualification requirements (both): built on **ENSv2 Sepolia**, ENSv2 features **central not
cosmetic**, functional demo (no hardcoded values), video/live demo, open-source repo.

---

## 1. Current state (ENSv1)

SoulVault currently uses ENSv1 Sepolia (flat `ENSRegistry` + `PublicResolver`) as its
**public configuration layer** — the onchain equivalent of `~/.soulvault/config`:

- Org name (e.g. `soulvault.eth`) carries text records:
  `soulvault.swarmContract`, `soulvault.chainId`, `soulvault.treasuryContract`,
  `soulvault.treasuryChainId`, `soulvault.publicManifestUri`, `soulvault.publicManifestHash`,
  `class` (`soulvault.organization`), `name`, `description`, `url`
- Org `soulvault.swarms` record: CBOR array of member swarm labels
  (`data:application/cbor;base64,…`) — read-modify-write, non-atomic, single-operator only
- ENSIP-11 multichain `addr(bytes32,uint256,bytes)` records for treasury discovery
- Swarm subnames exist only as labels inside the CBOR array — **not** independent ENS names
- Every write requires the org owner key (Ledger), even when an agent updates its own state

Code: `packages/node/src/ens.ts` (456 lines), consumed by `ens-name.ts`, CLI
`organization`/`swarm`/`sync` commands, and the ledger auto-sync path.

## 2. ENSv2 feature → SoulVault mapping (the "tick every box" matrix)

| ENSv2 feature | SoulVault use | Why it's central, not cosmetic |
|---|---|---|
| **Hierarchical registries** (`IRegistry`, subregistry pointers) | Deploy a **SoulVault subname registry** under the org name (`*.soulvault.eth`). Each swarm (`ops.soulvault.eth`), treasury, and agent becomes a real registry entry — replacing the CBOR label list. | The registry *is* the config store: membership list = registry entries; add/remove swarm = register/unregister. No more read-modify-write CBOR. |
| **Custom subname registry** (Registry Template / Verifiable Factory) | `SoulVaultRegistry` deployed via the Verifiable Factory, owned by the org, with swarm registration rules (e.g. only owner-approved labels, epoch-bound expiries). | We become a first-class ENSv2 namespace operator, exactly the "deploy your own subname registry to tokenize and manage subnames under your own rules" use case. |
| **Enhanced Access Control (EAC)** | Role mapping: org owner = admin; swarm agents hold `ROLE_SET_RESOLVER` on *their* name only; treasury bot holds a renewal role. Per-record resolver roles let an agent edit only `soulvault.*` records, never `class` or owner records. | Kills the "every write needs the Ledger" bottleneck — agents self-serve scoped updates. Directly answers the prize brief: "letting an account edit only certain text records on a name." |
| **Permissioned Resolver (per-account) + record aliasing** | Each swarm/agent name gets its own resolver proxy; alias shared records (`soulvault.chainId`) once at the org resolver instead of repeating per name. | Subnames "fully own their data"; aliasing dedupes chain-ID constants. |
| **Wildcard / longest-suffix resolution** (Universal Resolver V2) | Readers (otto/dashboard, `soulvault sync`) resolve `ops.soulvault.eth` through the org resolver without per-name resolver deployment. | Simpler bootstrap: a new swarm resolves immediately under the org resolver, then can graduate to its own. |
| **Expiring subnames** | Swarm subnames carry expiry synced to **epoch cadence** — expiry = liveness signal; treasury `renew()` extends on epoch rotation. | Names become *revocable, expiring* swarm identities — governance for free. |
| **Namespace aliasing** | Alias `soulvault.eth` entries to a mirror namespace (e.g. `soulvault.wallet.eth`) for migration bridging / multi-tenant orgs. | One registry, two namespaces — zero-copy aliasing. |
| **Emancipated / forever names** | The org root and the canonical registry name are emancipated (no parent control) — identity survives even if the .eth parent changes hands. | Trust story for a continuity layer: the namespace cannot be revoked upstream. |
| **Agents as namespaces** (bonus) | Each ERC-8004 agent identity maps to `<agent>.swarm.soulvault.eth` with its own Permissioned Resolver + EAC roles; ERC-8004 registration writes the ENSv2 name into agent metadata. | "Agents as namespaces, each with their own identity and permissions" — verbatim prize bonus. |

## 3. Architecture

```
.eth (ETHRegistry, ENSv2 Sepolia)
└── soulvault.eth  — ETHRegistry entry, org-owned (Ledger 0x56C5…287b)
    │ resolver: org Permissioned Resolver (class, name, description, url, manifest)
    │ subregistry: SoulVaultRegistry (custom, via Verifiable Factory)
    │
    ├── <swarm>.soulvault.eth        — one entry per swarm (expiring, epoch-synced)
    │   resolver: swarm Permissioned Resolver
    │     · soulvault.swarmContract / chainId
    │     · soulvault.treasuryContract / treasuryChainId (ENSIP-11 addr records)
    │     · soulvault.publicManifestUri / Hash
    │   EAC: agent wallet holds SET_RESOLVER(+record roles) on this name only
    │
    └── <agent>.<swarm>.soulvault.eth — agent namespace (ERC-8004 ↔ ENSv2 bridge)
        resolver: agent Permissioned Resolver (erc8004.registry, erc8004.agentId)
```

**Two-lane layout stays:** 0G Galileo (swarm ops contracts) + Sepolia (ENSv2 identity lane,
chain ID 11155111, RPC `https://ethereum-sepolia-rpc.publicnode.com`).

### Sepolia ENSv2 beta contracts (from docs.ens.domains/learn/deployments)

| Contract | Address |
|---|---|
| ETHRegistry (PermissionedRegistry) | `0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2` |
| ETHRegistrar | `0xa88553f454b77203b0d036a05c894d555eaaa2cc` |
| ENSV2Resolver | `0x508cb4e4596429ca98a1bb3112d88d18f92456b5` |
| BatchRegistrar | `0x8b16d15f3e51074d0e06f3cf4a0053f7cb92a7fb` |
| Universal Resolver V2 | see deployments page (resolution entrypoint) |

Contracts repo: `ensdomains/contracts-v2` (Foundry remappings per the official tutorial:
`@ensdomains/contracts-v2/` + its bundled OpenZeppelin).

## 4. Implementation plan

### Phase 1 — ENSv2 foundation (`packages/node/src/ensv2.ts`)
1. Vendor `ensdomains/contracts-v2` ABIs (PermissionedRegistry, ENSV2Resolver, ETHRegistrar,
   Verifiable Factory) into the node package; viem clients against Sepolia.
2. New env config: `SOULVAULT_ENSV2=1`, `SOULVAULT_ENSV2_REGISTRY`,
   `SOULVAULT_ENSV2_RESOLVER`, `SOULVAULT_ENSV2_FACTORY` (defaults = Sepolia beta addresses).
3. Feature-flagged path in `ens.ts` entry points: `readText`/`setText`/`setAddrMultichain`
   dispatch to v1 or v2 by flag so all existing callers migrate transparently.

### Phase 2 — SoulVaultRegistry (custom subname registry)
4. Foundry package `contracts/ensv2/` implementing the tutorial's UserRegistry pattern:
   flat-fee-free, owner-approved registration (`ROLE_REGISTRAR`/`ROLE_RENEW` on
   ROOT_RESOURCE granted to the SoulVault registrar), epoch-bound expiries.
5. CLI: `soulvault organization deploy-registry` (Verifiable Factory), `swarm register-ens`
   writes the swarm entry + its Permissioned Resolver, sets records.

### Phase 3 — EAC role wiring (the agent unlock)
6. `soulvault ens grant --name <swarm>.soulvault.eth --role set-resolver --to <agent-wallet>`
   — scoped delegation; agents update their own records without the org Ledger.
7. Agent watcher: on `BackupRequested`/`MemberFileMappingUpdated`, agent refreshes its ENS
   metadata itself (scoped role), removing the owner round-trip.
8. Record-level delegation for per-record roles (agent edits `soulvault.*`, cannot touch
   `class`) — the exact EAC demo the prize describes.

### Phase 4 — Epoch-expiry + renewal + aliasing
9. Swarm subname expiry = epoch end; treasury renewal job calls `registry.renew()`.
10. Namespace aliasing: mirror namespace via shared registry (migration/tenant story).
11. ERC-8004 bridge: agent registration writes `<agent>.<swarm>.soulvault.eth` into the
    ERC-8004 URI; `soulvault agent show` resolves reverse records via ENSv2.

### Phase 5 — Migration + docs + demo
12. Migration path for existing v1 names (per docs: locked/unlocked/unwrapped taxonomy;
    v1 mirror resolver keeps reads alive during transition).
    **DONE:** `docs/ensv2-migration.md` (commit 63802d6+) — taxonomy mapped to
    MigrationHelper/Unlocked/Locked controllers, mirror-resolver read lane, per-layer
    re-registration flow, compatibility via Phase 1 dispatch. Live rehearsal pending
    funded wallet.
13. README: **ENS track progress** + **ENS developer challenge notes** tables (same format
    as Ledger/World sections — sponsor feedback requirement). **DONE (63802d6).**
14. Demo script: register org registry → register swarm with expiry → grant agent scoped
    role → agent self-updates record → wildcard resolution from otto dashboard → expiry/
    renewal via treasury. **DONE:** `docs/ensv2-demo-script.md` (runbook, acts 0–5 mapped
    to spec items; live execution + video pending funded wallet).

## 5. Qualification checklist

- [x] Built on ENSv2 Sepolia (custom subname registry + EAC + Permissioned Resolvers)
- [x] ENSv2 central to product: registry IS the config layer (this spec, phases 1–4)
- [ ] Functional demo, no hardcoded values (Phase 5 demo script)
- [ ] Video + live demo (Phase 5)
- [ ] Open source (repo is public)
- [ ] Continuity documentation: pre-existing v1 work documented, v2 work judged on its own
- [ ] Feedback doc for ENS team (challenge notes table)

## 6. Risks / open questions

- **Beta churn:** contracts-v2 addresses may move; pin the commit hash (97a5729) and
  re-verify before demo.
- **v1-mirror read path (verified 2026-09-10):** for v2 names that are unregistered on
  v2 (e.g. `soulvault.eth` while owned only in v1), the v2 hierarchy's resolver slot
  points at an ENSV1Resolver-style mirror (`0xae66…b2ba`, `REGISTRY_V1` = flat v1
  registry). Its `resolve(bytes,bytes)` is the ONLY supported entry point — direct
  `text()`/`addr()` calls revert with `require(false)`. However, the v1 chain for such
  names is also empty (`v1.resolver(soulvault.eth) = 0x0`, root resolver = `0x0`), and
  v1's `eth` node resolver was repointed at the ENSV2Resolver (`0x508c…56b5`, whose
  `ETH_RESOLVER` override = `0x6f98…` and REGISTRY_V1 = flat v1 registry) — so both
  sides bounce into each other and `resolve()` reverts empty for these names. Net:
  **v1-records reads for v2-unregistered names are genuinely unavailable**, not a
  client bug. Phase 1 scope holds: text/addr reads via v2 only make sense for names
  registered on v2 (need Scott-funded test wallet + ETHRegistrar
  `0xa88553f454b77203b0d036a05c894d555eaaa2cc` registration to prove end-to-end).
  Confirmed independent: `viem`'s stock `getEnsText`/`getEnsAddress` for
  `soulvault.eth` on Sepolia also return null (no records exist to find).
- **Existing org name migration:** `soulvault.eth`-style names registered via the v1
  ETHRegistrar on Sepolia need the v1→v2 migration flow (Graveyard / DNSV1 mirror paths) —
  validate whether a *fresh* v2 registration is simpler for the demo.
- **Ledger clear-signing:** new registry/resolver selectors need ERC-7730 descriptors for
  clear signing, or fall back to `blind-only` for the demo with a documented caveat.
- **Gas/cost:** Verifiable Factory deployments on Sepolia — trivial, but document.

## 7. Addendum — documents lane: DocumentRegistry discovery (must not be lost in the v2 migration)

The documents pipeline (redact → publish → grant → rehydrate,
`SoulVaultDocumentRegistry` + `docs/redaction-hydration-spec.md`) is **absent from the
architecture above** — it is not org- or swarm-scoped, it is a **global per-chain
singleton** so an external consumer (Charlie) who is *not* in any swarm can verify and
rehydrate. That consumer-facing role makes its discovery a first-class ENS concern.

**Problem (today, ENSv1):** the registry address reaches the browser only via
`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` (build-time env). The public bundle carries no
chain/registry pointer, and the RehydrationKey EIP-712 attestation domain pins
`verifyingContract = registry` — so Charlie must resolve the registry address *before*
he can attest. An external consumer currently has no path.

**Design:**

1. **ENSIP-11 on the protocol root name** — `addr(soulvault.eth, coinType(chainId))` →
   the `SoulVaultDocumentRegistry` for that chain. Same pattern as treasury discovery,
   applied to protocol infrastructure. One record set covers every chain we deploy to;
   readers resolve through the ENSv2 Universal Resolver V2.
2. **Write path rides the EAC unlock (Phase 3)** — the record lives on the org's
   Permissioned Resolver, so a wallet holding the scoped record role can maintain it
   without the org Ledger. Publishing a new registry deployment (rare) should still be
   owner-gated (separate role, e.g. `ROLE_PROTOCOL_RECORDS`).
3. **Self-describing bundle hint (non-authoritative)** — `serializePublicDocumentBundle`
   gains an optional `registry: { chainId, address }` field (protocol version note:
   additive, readers treat absence as unknown). The Rehydrate UI compares hint vs the
   ENS-resolved answer and warns on mismatch — ENS is the trust anchor, the hint is
   convenience/portability (same pattern as the ops swarm's stale `soulvault.chainId`
   lesson).
4. **Preference order** for registry resolution:
   `localStorage override → ENS (soulvault.eth ENSIP-11) → env var → bundle hint`.
5. **Attestation domain unchanged** — `verifyingContract` stays the registry contract;
   the ENS version used for discovery does not enter the domain. Registry *rotation* is
   handled by the existing attestation `expiry`, not by re-attestation on ENS changes.

**Implementation touchpoints:**
- Phase 1 (`ensv2.ts`): the `setAddrMultichain` dispatch must cover this write — the
  registry record is just another ENSIP-11 slot on the root name.
- Phase 5 demo: extend the demo script — consumer resolves `soulvault.eth` → registry →
  verifies `DocumentPublished` → attests → rehydrates granted slots, **no env vars, no
  swarm membership**.
- Dashboard ticket 012 (otto/dashboard-ui) section D tracks the same work from the
  browser side; v1 implementation should land there first and dispatch to v2 via the
  same flag as the rest of `ens.ts`.
