# ENSv2 migration path for SoulVault names

Phase 5, item 12 of `ensv2-integration-spec.md`. Covers what happens to existing
SoulVault ENSv1 names (org roots, swarm subdomains, agent subnames) when the
identity lane moves fully to ENSv2 Sepolia.

## Taxonomy (per ENSv2 migration contracts, vendored @ 97a5729)

The ENSv2 migration machinery (`lib/ens-contracts-v2/contracts/src/migration/`)
classifies every v1 name into one of three states:

| State | Meaning | Migration vehicle |
|-------|---------|-------------------|
| **Unwrapped** | Owner holds the plain ETHRegistrar NFT (2LD, e.g. `soulvault.eth`), NameWrapper never involved. | `UnlockedMigrationController` — ERC-721 receiver takes the NFT, registers the name in the v2 ETH `PermissionedRegistry` directly. |
| **Unlocked (wrapped)** | Wrapped in NameWrapper but no locking fuses burned (`isLocked(fuses) == false` for `CANNOT_UNWRAP` etc.). | `UnlockedMigrationController` via `MigrationHelper` — owner approves the helper, name lands in v2 with chosen `subregistry` + `resolver` (the `LibMigration.Data` payload). |
| **Locked (wrapped)** | Protecting fuses burned (`PARENT_CANNOT_CONTROL`, `CANNOT_UNWRAP`, …) — common for subnames that must be safe from parent control. | `LockedMigrationController` + `LockedWrapperReceiver` — the wrapper's lock state is reproduced as v2 role restrictions instead of fuses; owners cannot re-lock differently than they were. |

Batch migration groups subnames by owner (`LockedChildren.parentName` + groups of
`LibMigration.Data`), so an org can move `soulvault.eth` plus all its swarm/agent
subnames in one approval flow.

## SoulVault's migration story

### 1. Org root (`soulvault.eth`)

- Migrate via the **unlocked** path: approve `MigrationHelper`, pass
  `LibMigration.Data { label: 'soulvault', owner: org Ledger, subregistry: org
  SoulVaultRegistry, resolver: ENSV2Resolver }`.
- Immediately after, run `organization deploy-registry` (Phase 2) if not already
  deployed, and `setSubregistry` the root so all children resolve through the org
  registry.

### 2. Swarm subnames (`<swarm>.soulvault.eth`)

- Swarm names registered in v1 mirror resolvers keep **reads alive during the
  transition** via ENSv2's `AbstractMirrorResolver`: the v2 entry's resolver
  delegates `resolve()` back to the v1 resolver (`IExtendedResolver` →
  `_findResolver(name)`) until the swarm's records are re-set on a v2
  Permissioned Resolver. Writes stop on v1 the moment the v2 entry exists.
- Re-registration into the org registry uses `swarm register-ens` with
  `--expiry-days` matching the current epoch cadence — the epoch-renewal hook
  (Phase 4a) then owns expiry from the first rotation onward.
- Org root names can be registered directly on ENSv2 with
  `organization register-ens --ens-v2`: deploy (or reuse, trust-checked) the org
  SoulVaultRegistry, register the label with an epoch-bound expiry, then mirror
  the `soulvault.ensv2Registry` pointer + metadata records. Skips the v1
  commit/reveal registrar and NameWrapper unwrap entirely.

### 3. Agent subnames (`<agent>.<swarm>.soulvault.eth`)

- Re-register via `agent register-ens` (Phase 4b); re-mirror the ERC-8004
  records (`erc8004.registry`, `erc8004.agentId`) — the v1 mirror resolver
  serves stale reads only for records the agent does not rewrite first.
- EAC grants do not carry over: re-run `ens grant` per scoped role. This is
  deliberate — grants are re-verified post-tx anyway.

### 4. Compatibility lane

- All SoulVault ENS entry points dispatch v1 ↔ v2 on `SOULVAULT_ENSV2=1`
  (Phase 1), so a partially migrated org keeps working: reads fall through to
  the v1 registry/resolver for any name without a v2 state, and the mirror
  resolver covers the gap window for external consumers.
- `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` continues to pin registry addresses for
  browser consumers; v2 org registries are discovered from the org ENS name's
  `soulvault.*` records instead, removing the build-time pin for new clients.

## Open items

- Live migration rehearsal on Sepolia once a funded wallet is available
  (MigrationHelper approval flow + fuse-state verification on a throwaway name).
- Graveyard (`migration/Graveyard.sol`) handling for abandoned v1 subnames —
  SoulVault orgs should explicitly unregister dead swarms rather than let them
  ride into the Graveyard with stale expiries.
