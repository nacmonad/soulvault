# ENS write batching: resolver multicall to cut wallet prompts

## Parent

[011-ens-native-state.md](./011-ens-native-state.md) — ENS-native state epic

## Problem

ENS-native state means more writes land as transactions, and today each
resolver call is its own transaction + wallet prompt + Ledger confirmation.
Concrete counts:

- Treasury wizard: deploy + `setAddr` + `setText(soulvault.treasuries)` =
  **3 prompts** (3–4 once 012 lands).
- Swarm wizard: deploy + subnode + `setAddr` + 2× `setText` + org-list
  `setText` = **6 prompts** (7 with 012's deploy-block record).

Beyond friction, every extra prompt is another blind-signing surface and
another partial-failure state to recover from.

## What to build

- Use the PublicResolver's `multicall(bytes[])` (and `multicallWithNode`)
  to batch same-resolver writes into one transaction:
  - Treasury ENS step: `setAddr` + `setText(soulvault.treasuries)` + (012)
    deploy-block write → **1 prompt**.
  - Swarm ENS step: subnode creation still needs the registry tx (separate
    contract), but the resolver writes (`setAddr`, `soulvault.chainId`,
    `soulvault.swarmContract`, (012) `soulvault.deployedAtBlock`) batch into
    one → **2 prompts + org-list append** (which stays separate to keep its
    idempotent read-modify-write).
- CLI `bindSwarmEnsSubdomain` / `bindTreasuryEnsAddr` gain the same batching
  (ethers v6 `resolveArray` / manual `encodeFunctionData` batch — keep
  parity with the browser implementation).
- Read-back verification stays (per-record reads after the batch tx).
- Wire-format note: `multicall` takes an array of arbitrary resolver-call
  calldata; both sides must encode identically. Cross-test the encoder.

## Acceptance criteria

- [ ] Treasury wizard: 2 prompts total (deploy + one batched ENS tx).
- [ ] Swarm wizard: deploy + subnode + one batched resolver tx + optional
      org-list tx = ≤ 4 prompts.
- [ ] CLI flows produce byte-identical resolver state to the browser flows
      (cross-tested, per the 011 parity principle).
- [ ] Batch failure surfaces which sub-call reverted (decode the multicall
      return data) instead of a generic revert.
- [ ] Speculos e2e still passes with the reduced prompt count.

## Blocked by

[012-ens-deployment-bootstrap.md](./012-ens-deployment-bootstrap.md) — batch
after the record set is final, so we don't re-cut the multicall grouping.
