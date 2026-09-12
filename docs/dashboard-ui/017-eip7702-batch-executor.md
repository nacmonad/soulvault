# 017 — EIP-7702 batch executor: one-signature atomic wizard flows

Parent: [000-parent.md](000-parent.md) · Related: 009-create-flows.md, 013-ens-write-batching.md, 016-wizard-existing-deployment.md

## Problem

Every creation wizard is a multi-transaction sequence with data dependencies, and the
EOA model gives us no way to batch: an EOA transaction has exactly one `to`, so every
cross-contract step is its own tx, its own wallet/Ledger prompt, and its own
partial-failure state to recover from. Concretely (counts from 2026-09-09 runs):

- Swarm wizard: deploy + subnode + `setAddr` + `setText`×2 + org-list append =
  **3 txs / ~5 prompts**, every one blind-signed via a keccak hash check on the device.
- Treasury wizard: deploy + ENSIP-11 `setAddr` + `soulvault.treasuries` append =
  **3 txs**.

We hit the failure mode twice in one day: a mid-sequence error (RPC 429s, Ledger
timeouts, ephemeral publicnode reverts) left half the flow on-chain and required the
`PartialFailureNote` / "re-run only what remains" machinery to claw back. Atomicity
would have made each of those a clean all-or-nothing retry.

The obvious fix — a plain multicall executor contract — does not work for our deploy
steps: `SoulVaultSwarm`'s constructor sets owner from `msg.sender`, so a contract
executor doing the deploy becomes the swarm's owner, not the user. `transferOwnership`
afterwards just adds another tx and another trust surface.

## Proposal

Use **EIP-7702** (Pectra, live on Sepolia) to delegate the EOA to a small
`SoulVaultBatchExecutor` contract. Under delegation, calls into the executor execute
with `msg.sender == <the EOA>` — ownership semantics are preserved exactly — and the
executor can perform the whole wizard in **one outer transaction**:

```solidity
// Executor sketch — deployed once, verified. Enforced: msg.sender == address(this).
function execute(Call[] calldata calls) external payable;
// Call { address to; uint256 value; bytes data; }
// to == address(0) => CREATE (empty-to call), so contract deploys come from
// the EOA's address/nonce exactly like today's CLI behavior.
```

Flow becomes:

1. **One-time**: sign the 7702 authorization (type-4 tx, sets `eth` EOA code to the
   executor). Persists across transactions until revoked — not a per-flow cost.
2. **Per wizard**: 1 outer tx = deploy + subnode + resolver writes + org-list append.
   Any sub-call reverting reverts the whole tx → **zero partial state**, and the
   `PartialFailureNote` machinery becomes a fallback for non-delegated wallets only.

Prompt math: swarm wizard **1 sig** (vs 3 txs + per-tx hash checks today); treasury
wizard **1 sig** (vs 3). The idempotency/resume tooling (`list-sync`, adopt paths from
016) remains valuable for recovery from RPC failures *before* broadcast, but the
mid-sequence recovery class disappears.

## What to build

- `contracts/SoulVaultBatchExecutor.sol` + Foundry tests (ownership guard, CREATE
  path, revert-propagation, value handling). No upgradeability, no pausing — smallest
  possible attack surface.
- Shared encoder in `@soulvault/protocol` (isomorphic, no Node built-ins) producing
  the `Call[]` calldata, consumed by both `apps/web` (wizards) and `packages/node`
  (CLI) per the 011 parity principle.
- Wizard integration: detect delegation state (`eth_getCode` on the EOA ≠ empty);
  if delegated → batch path; if not → offer delegation (browser wallets may do this
  natively) or fall back to the current per-tx flow. Fallback stays first-class.
- CLI: `--batch` flag on `swarm create` / `treasury create` using the same encoder.
- Per-sub-call revert decoding: bubble up *which* step failed, same acceptance item
  as 013.
- Gas pre-flight against the configured RPC for the combined payload (public Sepolia
  RPCs already choke on large creation payloads solo — a batched one is bigger; may
  need a higher gas-headroom estimate or a "deploy as its own tx" escape hatch).

## Open questions

- **Ledger DMK type-4 support**: can the DMK sign a 7702 authorization-list tx at
  all (and does it clear-sign it)? If not, Ledger users stay on the fallback until
  the kit catches up — gate the rollout on a Speculos check, don't assume.
- **Clear signing**: batch calldata is opaque to the device without a CAL descriptor.
  Register the executor ABI in the Ledger CAL (or ship our own descriptor) so the
  device shows "call 1/5: deploy SoulVaultSwarm" instead of a hash. Pairs with the
  `feat/clear-signing` branch work.
- **Interaction with 013**: same-resolver writes batch via resolver `multicall`
  regardless; 7702 supersedes it for cross-contract grouping. Decide whether 013
  ships first as the near-term win (it does — smaller, no delegation needed) and
  7702 replaces the grouping, or skip 013 for delegated users.
- **Payload size**: deploy initcode + all ENS calls in one tx may exceed some public
  RPC gas-estimate limits; measure before committing to all-in-one.

## Acceptance criteria

- [ ] Swarm wizard end-to-end in 1 sig (after one-time delegation); treasury
      wizard ditto.
- [ ] Atomicity: injecting a failure at step k leaves **no** steps 1..k-1 mined
      (outer tx reverted) — test on Speculos + local ens-app-v3 harness.
- [ ] Ownership: deployed swarm/treasury owner is the user's EOA, not a contract.
- [ ] Non-delegated wallets get the current per-tx flow unchanged (fallback tests).
- [ ] Sub-call revert decoding surfaces the failing step name.
- [ ] CLI `--batch` produces identical on-chain state to the browser flow.

## Blocked by

Nothing hard — but sequence after 013 (near-term sig reduction, no new trust
assumptions) and coordinate with `feat/clear-signing` for the device UX.
