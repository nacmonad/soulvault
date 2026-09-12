# Multi-chain event watcher: one transport per chain

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

The event watcher is single-chain by construction: `SoulVaultEventWatcher`
holds one `publicClient` (`apps/web/src/lib/onchain/watcher.ts`), and the
events provider drops any discovered source whose `chainId` differs from the
watcher's chain (see `SoulVaultDeployment.chainId` in
`apps/web/lib/onchain/types.ts`).

Concretely today: an org's ENS `soulvault.treasuries` record lists treasuries
per chain — e.g. a 0G Galileo (16602) treasury alongside the Sepolia (11155111)
one — but the Galileo treasury's events (`FundsDeposited`,
`FundsReleased`, `TreasuryWithdrawn`) never appear in the dashboard feed. The
Treasury page already carries an amber "chain not watched" note and balances
read per-chain, so this is a watch-side gap, not a discovery gap. Discovery is
already multi-chain-aware: ENS records carry `chainId` per entry.

## Design

### A. Per-chain transport registry

- Extend RPC settings to a per-chain map: localStorage key
  `soulvault.rpcUrlOverride.<chainId>` (or one JSON map), with the
  `/dashboard/settings` page listing one row per known chain plus a
  "add chain" affordance.
- Ship a **curated default public-RPC map** keyed by chainId
  (`11155111` → publicnode/infura list as today; `16602` → 0G Galileo
  default endpoint) so multi-chain watching works with **zero config**, and
  the settings override remains the escape hatch. This mirrors how the ops
  lane and identity lane already resolve separate RPCs in the CLI
  (`SOULVAULT_RPC_URL` / `SOULVAULT_ETH_RPC_URL`).
- `createSoulVaultPublicClient` gains a chain-descriptor lookup (name,
  native currency — 0G uses ETH decimals 18 today but keep it per-chain
  explicit) instead of the synthetic `SoulVault chain <id>` placeholder.

### B. Multi-chain watcher

- `SoulVaultEventWatcher` becomes a thin registry over per-chain watchers (or
  gains a `clients: Map<chainId, PublicClient>`), grouping sources by
  `source.chainId ?? watcher chain` and scanning each group with its own
  client. `watchLive` runs one poll loop per chain; `onError` must not let a
  dead chain starve the others (per-chain error surface).
- Events gain `chainId` in `EventMeta`; `orderEvents` keeps
  `(blockNumber, logIndex)` ordering **within** a chain. Cross-chain ordering
  in the merged feed is wall-clock arrival (no shared clock exists) — render
  a chain chip per event row instead of pretending to interleave.
- Same-tx pair ordering (`FundRequestApproved` → `FundsReleased`) is
  chain-local and unaffected.

### C. Out of scope (explicitly)

- Wallet signing on non-watched chains: the browser wallet/ledger lane signs
  per its connected chain; per-chain signing selection is ticket-level work
  of its own. This ticket is **watch-only**.
- Multi-chain balance aggregation beyond what the Treasury page already does.

## Acceptance criteria

- [ ] With zero extra config, a Galileo (16602) treasury discovered via ENS
      appears in the Events feed and Treasury page (chain chip rendered), and
      `FundsDeposited`/`FundsReleased` from it show up live.
- [ ] Setting a per-chain RPC override in Settings changes only that chain's
      transport; other chains unaffected.
- [ ] One chain's RPC failing (429s, down) degrades only that chain: the
      events provider shows a per-chain error state, other chains keep
      streaming.
- [ ] `pnpm exec tsc --noEmit` clean; watcher unit tests cover source
      grouping by chainId and per-chain error isolation.

## Blocked by

None — builds on 012 (ENS deployment bootstrap) and 010 (RPC settings).
