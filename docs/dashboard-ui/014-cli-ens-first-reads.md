# CLI reads go ENS-first: profiles become caches

## Parent

[011-ens-native-state.md](./011-ens-native-state.md) — ENS-native state epic

## Problem

CLI read commands (`treasury status`, `swarm status`, `organization status`,
`status`) answer from `~/.soulvault/*.json` profiles. Those profiles are
machine-local facts that:

- go stale the moment another actor (browser wizard, another wallet, another
  machine) writes on-chain or to ENS;
- make the CLI the only client that can't see ENS-discoverable entities —
  the inverse of the dashboard after 012;
- block "run entirely web3-native": a colleague resolving
  `soulvault-demo.eth` gets the truth, while the org's own CLI shows a stale
  snapshot of it.

## What to build

- **ENS-first read path.** `treasury status` resolves via
  `addr(orgNode, coinType)` + `soulvault.treasuries`, then enriches with
  chain reads (balance, owner). `swarm status` resolves via the org's
  `soulvault.swarms` list + subdomain records + on-chain `swarm.treasury()`.
  Local profiles serve as offline fallback and are refreshed on successful
  reads (write-through cache).
- **Org enumeration stays local-honest.** ENS cannot enumerate "which names
  does this wallet own" without an indexer — the local org list remains the
  cache of orgs this machine has seen, but everything *about* an org comes
  from ENS. Document this in `skills/soulvault/references/`.
- **`--ens` / `--offline` flags** where ambiguous: `--offline` forces cache
  (already exists for `status`), `--refresh` forces a chain/ENS round-trip.
- **Cache staleness signal.** Read commands print the source:
  `source: ens (block 7,4xx,xxx)` vs `source: cache (2h old)` — consistent
  with the dashboard's "derived from chain, not a user database" stance.
- Profiles that disagree with ENS are corrected (cache rewritten from
  source), not trusted.

## Acceptance criteria

- [ ] Delete `~/.soulvault/treasuries/*.json` and `swarms/*.json` (keep
      `keys/`): `treasury status --organization soulvault-demo` and
      `swarm status` still work by resolving through ENS + chain.
- [ ] After any ENS write from the browser, the CLI reflects it without a
      local file edit (resolution order proven ENS-first).
- [ ] `--offline` still works off-cache for the fields the cache carries,
      and clearly labels staleness.
- [ ] `skills/soulvault/references/commands.md` + `state.md` (if present)
      document the cache-not-truth model.

## Blocked by

[012-ens-deployment-bootstrap.md](./012-ens-deployment-bootstrap.md) — read
parity needs the `deployedAtBlock`/record set final so both clients agree.
