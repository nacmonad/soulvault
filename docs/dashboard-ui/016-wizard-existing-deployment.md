# 016 — Create wizards: detect and adopt existing deployments

Parent: [000-parent.md](000-parent.md) · Related: 009-create-flows.md, 012-ens-deployment-bootstrap.md

## Problem

The swarm-create wizard always starts from step 1 ("Deploy SoulVaultSwarm") even when the
target subnode (`<label>.<org>.eth`) already resolves to a live swarm contract. Encountered
2026-09-09: `ops.soulvault-demo.eth` already resolved to `0x209E…26C8` with
`treasury() == 0x315C…3817`, but the wizard happily re-attempted the deploy, which either
duplicates the swarm or fails later at the ENS-bind step ("subnode owned") after gas was
already spent. The same applies to the treasury wizard for an org that already has a bound
treasury.

## Proposed behavior

Before the deploy step, the wizard runs a read-only pre-flight (all reads, no wallet needed):

1. Resolve `<label>.<org>.eth` → if it has a resolver with an `addr` record, read the
   contract's `treasury()`.
2. If the resolved contract is a live `SoulVaultSwarm`:
   - If `treasury()` matches the org's resolved treasury → show **"Swarm already exists at
     this name — adopting it"**, skip deploy + ENS steps, write/refresh local state, jump to
     verification.
   - If it points somewhere else → hard-stop with an explanation and a
     `CliRecoveryHint` (adopt via CLI or unpublish/rebind) instead of a deploy attempt.
3. If the subnode is unowned but the org's `soulvault.swarms` list already contains the
   label → warn before deploy that discovery-list reconciliation may be needed.

The CLI should get the same courtesy: `swarm create` resolving an owned subnode should fail
fast with "already bound to 0x…, pass --adopt to use it" rather than deploying first and
dying at bind time.

## Notes

- Deployed-but-unbound (crash between deploy and ENS steps) is the partial-state case the
  wizard's `PartialFailureNote` already handles; the pre-flight above is a *pre*-deploy
  check and composes with it.
- The CLI-side adoption path exists in `createSwarmProfile` (`contractAddress` input skips
  deployment) but currently re-attempts the ENS bind unconditionally; an `--adopt` flag
  should skip both deploy and bind and just reconcile local state.
