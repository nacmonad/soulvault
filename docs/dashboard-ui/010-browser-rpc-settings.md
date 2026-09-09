# Browser RPC settings + rate-limit-safe log fetching

## Parent

(this epic) — Wallet-native dashboard: org/swarm/agent shell + documents UI

## Problem

The dashboard's only RPC knob is the build-time `NEXT_PUBLIC_SOULVAULT_RPC_URL`.
Against free public endpoints (publicnode) a full history scan is ~27
`eth_getLogs` chunks (50k-block provider cap × 1.08M blocks from the ERC-8004
deploy block), fired in a burst on wallet connect — the provider answers with
`Rate limit exceeded`. Operators need a way to point the browser at a better
endpoint (personal token, dedicated node, local node) without rebuilding, and
the fetchers need to behave like well-behaved clients of rate-limited RPCs.

## What to build

### A. RPC override in browser settings

- New `lib/rpc-settings.ts`: read/write/clear a localStorage key holding an
  RPC URL override (`soulvault.rpcUrlOverride`). Validate with `new URL()` +
  `https:` (or `http:` for local nodes) before persisting.
- `getBrowserSoulVaultClientConfig()` precedence: localStorage override →
  `NEXT_PUBLIC_SOULVAULT_RPC_URL`. All config consumers (watcher, activity
  loader, treasury/ENS writes, wizards) inherit the override for free.
- `/dashboard/settings` page (nav item "Settings"): current effective RPC +
  source (override/env), input + save/clear, and a "test" button that does a
  live `eth_blockNumber` + `eth_chainId` against the candidate URL and shows
  the result before saving.

### B. Rate-limit-safe fetching

- `getLogsChunked` paces chunks (small delay between requests) and retries a
  chunk on rate-limit errors (match `rate limit|429|too many`, exponential
  backoff starting 1s, max 3 retries) before surfacing the error.
- Applies to both consumers (event watcher + wallet activity loader) since
  they share the helper.

## Acceptance criteria

- [ ] With an override set, all dashboard chain reads/writes target it (spot
      check: Settings shows it effective; Events page queries it).
- [ ] A full 1.08M-block identity scan completes against publicnode free tier
      without a rate-limit error (paced + retried).
- [ ] Clearing the override reverts to the env RPC immediately.
- [ ] Invalid URLs (non-http(s), garbage) never persist; the UI explains why.

## Blocked by

None. Builds on the chunked `getLogs` fix (PR #21).
