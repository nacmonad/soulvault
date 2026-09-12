# ENS deployment bootstrap: derive dashboard deployments from ENS records

## Parent

[011-ens-native-state.md](./011-ens-native-state.md) — ENS-native state epic

## Problem

The dashboard's event watcher and treasury flows need a `fromBlock` per
contract, which today comes only from `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` —
a build-time env var listing `{kind, address, fromBlock, label}`. That means:

- a fresh machine (or the wizard's own output) requires a manual env edit +
  rebuild before the dashboard sees what it just deployed;
- two actors don't agree on what exists — the wizard deploys + writes ENS,
  then *also* tells the user to paste a config snippet;
- the whole point of ENS discovery (any wallet can resolve the org's
  infrastructure from its name) is bypassed by our own UI.

## What to build

### A. Record the deploy block at write time

- Treasury enumeration record entries gain an optional
  `deployedAtBlock?: number`:
  `{chainId, address, label?, createdAt?, deployedAtBlock?}`. The browser
  wizard knows the receipt block — write it. CLI `treasury create` writes it;
  `treasury bind` can resolve the deployment tx via `getContractDeployment`
  (or omit when unknown — the field is optional).
- Swarm binding gains a `soulvault.deployedAtBlock` text record on the swarm
  subdomain, written by both the wizard (`bindSwarmEnsSubdomain`) and the CLI
  `swarm create`. Purely additive; readers treat absence as "scan from the
  fallback block" (current behavior).
- `deploySoulVaultTreasuryContract` / wizard deploy step: thread the receipt
  block into the ENS write step.

### B. Dashboard reads deployments from ENS

- New `lib/ens-discovery.ts` (or extend `ens-writes.ts`): given the selected
  org ENS name, produce the same shape `parseSoulVaultClientConfig` returns
  today — treasury + swarm `{address, kind, fromBlock, label}` — by reading
  `soulvault.treasuries` + `soulvault.swarms` + the swarm subdomain records.
- `treasuryDeployment()` / `swarmDeployment()` / watcher source config:
  ENS-derived first, env-var deployments as fallback when no org is selected
  or records are absent. localStorage override (settings page) still wins for
  RPC.
- Wizards post-success: replace the `NEXT_PUBLIC_SOULVULT_DEPLOYMENTS`
  snippet with "Discoverable via ENS — select the org to see it" (keep the
  snippet behind a collapsible for env-based setups).

### C. CLI parity

- `swarm-deploy.ts` binding writes `soulvault.deployedAtBlock`; treasury
  deploy/bind writes `deployedAtBlock` into the enumeration record entry.
- Format changes are reflected in both test suites (byte/format parity).

## Acceptance criteria

- [ ] Dashboard is fully functional (treasury tab, events, fund requests)
      with `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` **unset**, org selected —
      everything derives from ENS + chain reads.
- [ ] Wizard-created treasury/swarm appear in the dashboard immediately
      after their ENS steps confirm, with no env edit or rebuild.
- [ ] Records written by the CLI decode in the browser and vice versa
      (cross-tested: `deployedAtBlock` present/absent on both sides).
- [ ] Absent `deployedAtBlock` falls back to today's scan window without
      error (backward compatible with records written before this ticket).
- [ ] Stealth swarms (no ENS binding) still work — they're simply not
      ENS-discoverable, exactly as today.

### D. DocumentRegistry discovery (documents lane)

The `SoulVaultDocumentRegistry` is a global per-chain singleton (not org-scoped —
external consumers publish/verify/rehydrate without swarm membership), so it does not
come from the org's records like treasuries/swarms. Discovery design lives in the
ENSv2 integration spec (docs/ensv2-integration-spec.md §7 on feature/ensv2-integration):

- `addr(soulvault.eth, coinType(chainId))` → DocumentRegistry for that chain (ENSIP-11,
  same pattern as treasury discovery, on protocol infrastructure instead of org assets).
- Public bundle gains an optional non-authoritative `registry: {chainId, address}` hint;
  ENS is the trust anchor, the UI warns on mismatch.
- Resolution preference: localStorage override → ENS → env var → bundle hint.
- Attestation domain unchanged (`verifyingContract` = registry); rotation handled by
  attestation expiry.

Implement v1-side here first (readENSIP-11 fallback in `documentRegistryAddress()`),
dispatching to ENSv2 via the same feature flag as `packages/node/src/ens.ts` so both
sides migrate together.

## Blocked by

None. Stacks on the `soulvault.treasuries` record (this branch).
