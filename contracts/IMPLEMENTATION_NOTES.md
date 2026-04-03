# SoulVault Swarm Implementation Notes

## Current status
`contracts/SoulVaultSwarm.sol` is a **first-pass MVP implementation stub** aligned with:
- `ISoulVaultSwarm.sol`
- `SWARM_CONTRACT_SPEC.md`

## What it implements
- owner-gated joins / rejection / removal
- epoch rotation reference updates
- historical key bundle reference events
- per-member file mapping writes
- verified messaging metadata posting
- coordinated backup trigger events
- agent manifest pointer updates
- pause / unpause
- public `requestRekey()` hook

## What is intentionally simple right now
- no role system beyond `owner`
- no quorum / coordinator role
- no upgradeability
- no ERC-8004 linkage stored onchain
- no per-epoch historical storage of file mappings
- no pagination / enumerable member set
- no richer validation around refs or hashes

## Likely next improvements
- coordinator role for `requestBackup`
- explicit historical mapping history rather than only latest per member
- owner/member publication policy refinement
- tests for join lifecycle, rekey protection, seq enforcement, and backup triggers
- optional events or views for ERC-8004 linkage metadata
