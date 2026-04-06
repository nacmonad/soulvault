# SoulVault Swarm Implementation Notes

## Current status
`contracts/SoulVaultSwarm.sol` and `contracts/SoulVaultOrganization.sol` are aligned with:
- `ISoulVaultSwarm.sol` / `ISoulVaultOrganization.sol`
- `SWARM_CONTRACT_SPEC.md` / `ORGANIZATION_CONTRACT_SPEC.md`

## What is implemented
- owner-gated joins / rejection / removal
- epoch rotation reference updates
- historical key bundle reference events
- per-member file mapping writes
- verified messaging metadata posting
- coordinated backup trigger events
- agent manifest pointer updates
- pause / unpause
- public `requestRekey()` hook
- **fund request lifecycle** (swarm-side request/cancel + organization-side approve/reject/payout, linked by mutual consent via `swarm.organization()`)
- **SoulVaultOrganization** as the org-scoped contract (swarm registry, org-level pause, fund custody + payout), deployed once per organization on 0G Galileo, discovered via ENS text records on the org's root ENS name

## What is intentionally simple right now
- no role system beyond `owner` (on either contract)
- no quorum / coordinator role
- no upgradeability — any contract change requires a fresh deploy + profile refresh
- no ERC-8004 linkage stored onchain
- no per-epoch historical storage of file mappings
- no pagination / enumerable member set
- no richer validation around refs or hashes
- **fund requests are native-only** — `FundRequest` struct has no `token` field; ERC-20 support is a future v2 struct migration
- **no per-swarm spending caps or rate limits** on the organization contract — the organization owner is the v1 rate limiter
- **hand-maintained ABI fragments** in `cli/src/lib/swarm-contract.ts` and `cli/src/lib/organization-contract.ts` — TODO: regenerate from forge artifacts to eliminate drift

## Follow-up items flagged during feat/agent-request-funds

### Pause/unpause exposure in the CLI (swarm)
`pause()` and `unpause()` are implemented on `SoulVaultSwarm` and guard all fund-request operations via the `whenNotPaused` modifier. Foundry tests fully cover the paused behavior (`test/SoulVaultSwarm.t.sol::testRequestFundsBlockedWhenPaused`, `test/SoulVaultFundRequest.t.sol::testPausedBlocksApproval`). However:
- `SOULVAULT_SWARM_ABI` in `cli/src/lib/swarm-contract.ts` does NOT include `pause()` / `unpause()` fragments
- There are no `soulvault swarm pause` / `soulvault swarm unpause` commands
- The CLI integration test (`cli/src/lib/__integration__/fund-request-flow.integration.test.ts`) works around this by instantiating a separate `swarmPauseCtl` Contract with a 3-line inline ABI

Exposing `pause` / `unpause` in the CLI is a clean follow-up branch (e.g. `feat/cli-swarm-pause`): add the two fragments to the main ABI, add the two commands in `cli/src/commands/swarm.ts`, drop the workaround from the integration test.

### Optional constructor-time organization binding
`SoulVaultSwarm.constructor()` currently takes no arguments. The organization is always bound post-deploy via `setOrganization(address)`. This is deliberate (chicken-and-egg: the organization contract is deployed before the swarm in the CLI flow, but the swarm address isn't known until after `swarm create`) and compatible with the re-settable binding decision.

A clean follow-up is to change the constructor to `constructor(address initialOrganization)` where:
- `initialOrganization == address(0)` → behaves identically to today (unbound until `setOrganization`)
- `initialOrganization != address(0)` → sets `organization` immediately and emits `OrganizationSet(address(0), initialOrganization, msg.sender)`

This saves one tx for deployers who know the organization address in advance. The ethers `ContractFactory` default args `()` still work, so existing Foundry + CLI deploys remain unchanged. Same recovery path — `setOrganization` stays re-settable afterward.

No urgent reason to do this now; documented here so it's visible when someone wants the single-tx convenience.

### Organization-level pause (implemented — Option B checked flag)
Now that `SoulVaultOrganization` is a deployed contract, org-level pause is implemented via the **checked-flag pattern (Option B)**: the organization stores an `orgPaused` boolean, and each swarm's `whenNotPaused` modifier calls `ISoulVaultOrganization(organization).orgPaused()` in addition to checking its own `paused` flag. When `orgPaused` is true, all gated operations on every bound swarm revert atomically — no iteration over swarms required.

The owner toggles org pause via `pauseOrg()` / `unpauseOrg()`, which emit `OrgPaused` / `OrgUnpaused` events. This adds one `STATICCALL` per gated swarm operation, negligible relative to the cross-contract calls already in the fund-request flow.

### Other likely next improvements
- coordinator role for `requestBackup`
- explicit historical mapping history rather than only latest per member
- owner/member publication policy refinement
- optional events or views for ERC-8004 linkage metadata
- ERC-20 support on the organization contract (new request struct under a new counter)
- per-swarm spending caps / rate limits on the organization contract
