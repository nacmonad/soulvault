# Multi-chain event layer + config guard (two-lane discovery)

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

The browser event layer is **single-chain**: `client.ts` builds one
`PublicClient` from `NEXT_PUBLIC_SOULVAULT_RPC_URL` / `CHAIN_ID`, and
`SoulVaultDeployment` carries no chain info. Real deployments span both lanes:

| Lane | Chain | Contract | Verified on testnet |
|---|---|---|---|
| Ops | 0G Galileo (`16602`) | `SoulVaultSwarm` `ops` | `0xc7B54d0AFC3F1EF851Ef406186Fccaa9128aB646`, first activity block `25775898` |
| Identity | Sepolia (`11155111`) | ERC-8004 registry | `0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266`, first activity block `10592315` |

Result: the swarm panel and the agents/org panels can never be live in the
same dashboard session — pointing `DEPLOYMENTS` at a Sepolia config with the
0G swarm address quietly shows nothing, and vice versa. Ticket 002's views are
already implemented (a429ce3) but starve on data because of this.

Second bug: a `DEPLOYMENTS` array of `[]` parses as *valid* config with zero
sources; the watcher constructor then throws
`SoulVaultEventWatcher needs at least one deployment source` as an unhandled
rejection instead of rendering the config-error panel (violates ticket 001's
"missing config shows the existing config error" AC).

## What to build

1. **Per-deployment chain routing.** `SoulVaultDeployment` gains optional
   `rpcUrl` + `chainId`, falling back to the top-level `NEXT_PUBLIC_` values.
   `parseSoulVaultClientConfig` normalizes each entry into a lane
   `(rpcUrl, chainId)`.
2. **Lane-grouped watcher.** `SoulVaultEventWatcher` groups `sources` by lane
   and holds one `PublicClient` per lane. `scanHistory` / `watchLive` scan
   every lane and merge batches through the existing dedupe/merge path
   (`eventKey` = `txHash:logIndex` — tx hashes are globally unique across
   these chains, so no collision).
3. **`EventMeta.chainId`.** Every event records which lane it came from. The
   events page gains a chain column + filter.
4. **Ordering contract.** `orderEvents` keeps `(blockNumber, logIndex)`
   ordering **within** a lane — this preserves the critical same-tx pair
   `FundRequestApproved` (swarm) → `FundsReleased` (treasury), both on 0G.
   Cross-lane ordering is **not** a single timeline: block numbers are not
   comparable across chains. The UI groups/filters by chain and must not fake
   a global order. (If a merged chronological view is wanted later, it needs
   per-block timestamps — out of scope here.)
5. **Config guard.** `SoulVaultEventsProvider` treats a config with zero
   usable deployments exactly like missing config: `status: 'error'` with the
   existing `CONFIG_ERROR` message. No watcher construction, no throw. Same
   for a `JSON.parse` failure of `DEPLOYMENTS` (currently also unhandled —
   wrap it and fail into the config-error state).
6. **Org ENS reads ride the identity lane.** The org page currently guards on
   `config.chainId === sepolia.id` and reuses the global `rpcUrl`. After this
   change it must resolve ENS via the `identity` lane's `rpcUrl` (the entry
   with `kind: 'identity'`, or any Sepolia lane), independent of the
   top-level chain id.
7. **Docs.** Update `apps/web/.env.example`-shaped docs and the sample config
   in `docs/dmk-compliance-audit.md` with the per-deployment fields and the
   two-lane example below.

### Reference two-lane config (real testnet state)

```bash
NEXT_PUBLIC_SOULVAULT_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
NEXT_PUBLIC_SOULVAULT_CHAIN_ID=11155111
NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"swarm","address":"0xc7B54d0AFC3F1EF851Ef406186Fccaa9128aB646","fromBlock":25775898,"label":"ops","rpcUrl":"https://evmrpc-testnet.0g.ai","chainId":16602},
  {"kind":"identity","address":"0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266","fromBlock":10592315,"label":"erc8004"}
]
```

Treasury has not been deployed yet (`soulvault treasury create`,
story08 §0) — when it is, add a `treasury` entry on the 0G lane and the
swarm/treasury merge logic picks it up with no further UI work.

## Acceptance criteria

- [ ] `DEPLOYMENTS` entries may carry `rpcUrl` / `chainId`; missing values
      fall back to the top-level config. Parse errors and empty arrays render
      the config-error state — no unhandled rejection anywhere.
- [ ] With the two-lane reference config, one session shows: swarm
      membership/epoch reduced from 0G events, ERC-8004 agent profiles from
      Sepolia, and org ENS records resolved over the identity lane.
- [ ] `EventMeta.chainId` is populated; `/dashboard/events` shows and filters
      by chain.
- [ ] `(blockNumber, logIndex)` ordering is preserved within a lane
      (fixture: same-tx fund pair stays in order); cross-lane events are
      grouped per lane in the UI.
- [ ] Unit tests: config parse fallbacks; two-lane watcher merge; guard on
      empty/malformed config.
- [ ] `pnpm --filter soulvault-web typecheck` and `build:export` green.

## Blocked by

None. **Blocks** ticket 002 from showing real data; the document tickets
(003–006) are unaffected (their lane is already Sepolia-only) but gain
`chainId` for free.

## Implementation notes

- One `PublicClient` per lane, memoized by `(rpcUrl, chainId)` — do not
  create a client per deployment.
- `scanHistory` over both lanes runs concurrently (`Promise.all`); merge
  after all lanes settle so one failing lane surfaces an error instead of
  silently dropping the other lane's events (fail loud, per-lane error text
  naming the chain).
- Live polling stays one cursor loop per lane, same `pollSeconds`.
- Do not touch `packages/protocol` wire types or the reducers' event shapes —
  this is an `apps/web` transport change only.
- The document registry is **not** deployed to Sepolia yet and has no CLI
  deploy path; when the document flow resumes, add a `document` entry once a
  deploy path exists (tracked separately — out of scope for this ticket).
