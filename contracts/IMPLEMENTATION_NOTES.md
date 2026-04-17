# SoulVault Swarm Implementation Notes

## Current status
`contracts/SoulVaultSwarm.sol` and `contracts/SoulVaultTreasury.sol` are aligned with:
- `ISoulVaultSwarm.sol` / `ISoulVaultTreasury.sol`
- `SWARM_CONTRACT_SPEC.md` / `TREASURY_CONTRACT_SPEC.md`

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
- **fund request lifecycle** (swarm-side request/cancel + treasury-side approve/reject/payout, linked by mutual consent via `swarm.treasury()`)
- **SoulVaultTreasury** as a separate payable contract, deployed once per organization per chain on 0G Galileo, discovered via ENSIP-11 multichain `addr` record on the org's root ENS name (keyed by `coinType = 0x80000000 | chainId`)
- **Constructor-time treasury binding** — `SoulVaultSwarm.constructor(address initialTreasury)` accepts a treasury address at deploy time; non-zero values bind immediately and emit `TreasurySet`
- **Treasury `chainId()` view** — immutable value baked in at construction (`block.chainid`) for cross-chain mis-wiring detection

## What is intentionally simple right now
- no role system beyond `owner` (on either contract)
- no quorum / coordinator role
- no upgradeability — any contract change requires a fresh deploy + profile refresh
- no ERC-8004 linkage stored onchain
- no per-epoch historical storage of file mappings
- no pagination / enumerable member set
- no richer validation around refs or hashes
- **fund requests are native-only** — `FundRequest` struct has no `token` field; ERC-20 support is a future v2 struct migration
- **no per-swarm spending caps or rate limits** on the treasury — the treasury owner is the v1 rate limiter
- **hand-maintained ABI fragments** in `cli/src/lib/swarm-contract.ts` and `cli/src/lib/treasury-contract.ts` — TODO: regenerate from forge artifacts to eliminate drift

## Follow-up items flagged during feat/agent-request-funds and feat/ens-org-multichain-treasury

### Pause/unpause exposure in the CLI (swarm)
`pause()` and `unpause()` are implemented on `SoulVaultSwarm` and guard all fund-request operations via the `whenNotPaused` modifier. Foundry tests fully cover the paused behavior (`test/SoulVaultSwarm.t.sol::testRequestFundsBlockedWhenPaused`, `test/SoulVaultFundRequest.t.sol::testPausedBlocksApproval`). However:
- `SOULVAULT_SWARM_ABI` in `cli/src/lib/swarm-contract.ts` does NOT include `pause()` / `unpause()` fragments
- There are no `soulvault swarm pause` / `soulvault swarm unpause` commands
- The CLI integration test (`cli/src/lib/__integration__/fund-request-flow.integration.test.ts`) works around this by instantiating a separate `swarmPauseCtl` Contract with a 3-line inline ABI

Exposing `pause` / `unpause` in the CLI is a clean follow-up branch (e.g. `feat/cli-swarm-pause`): add the two fragments to the main ABI, add the two commands in `cli/src/commands/swarm.ts`, drop the workaround from the integration test.

### ~~Optional constructor-time treasury binding~~ ✅ Done

`SoulVaultSwarm.constructor(address initialTreasury)` now accepts an optional treasury address. Passing a non-zero address binds the swarm at deploy time and emits `TreasurySet(address(0), initialTreasury, msg.sender)`. Passing `address(0)` is a first-class supported value for stealth swarms or deferred treasury binding. `setTreasury` remains as a re-binder for migrations or rotation.

The CLI's `swarm create` auto-discovers the org's treasury via ENSIP-11 `addr(orgNode, coinType)` and passes it through to the constructor. The bootstrap order is now `org create` → `treasury create` → `swarm create` (the swarm is born already bound).

### Organization-level pause (design open)
The Organization entity is not a smart contract today — it's only an ENS name + local metadata. There is no on-chain way to halt every swarm + the treasury under an organization with a single signature. A cross-cutting kill switch would require either:
- deploying a new `SoulVaultOrganization` contract on 0G that swarms and the treasury check in their modifiers (extra storage slot + external call per gated op), OR
- a treasury-propagated pause where `SoulVaultTreasury` tracks registered swarms and can pause them all (fragile — swarms don't hold a back-reference today), OR
- off-chain only: `for swarm in swarms; do soulvault swarm pause; done` (not atomic, leaves a window where some swarms are paused and some aren't).

This is deferred as a design question, not scheduled work.

### Other likely next improvements
- coordinator role for `requestBackup`
- explicit historical mapping history rather than only latest per member
- owner/member publication policy refinement
- optional events or views for ERC-8004 linkage metadata
- ERC-20 support on the treasury (new request struct under a new counter)
- per-swarm spending caps / rate limits on the treasury
