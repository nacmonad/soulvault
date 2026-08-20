# Stray features — VPS working tree, not yet on main

A CLI feature set (~604 insertions / 94 deletions across 19 files + 1 new test) sits
uncommitted on a VPS checkout based on `df1a7c1`. That base is **47 commits behind**
`origin/main`, which has since landed the treasury system, ENSIP-11 discovery,
EIP-712 clear-signing, the monorepo restructure, and `apps/web`.

**This needs a port, not a pull.** The signer, ENS, organization, and swarm modules all
moved. Audited against `e7d23c5`; every item below is confirmed absent.

---

## Fixed — visibility now gates ENS binding

*Was: `--private` set `visibility` on the profile but the flag was never consulted before
publishing, so a private swarm under an org still got a public ENS subdomain and was
appended to the org's `soulvault.swarms` CBOR list. "Stealth" only meant "no
`--organization`".*

Resolved. The decision moved into `planSwarmEns()` in
[`packages/node/src/swarm.ts`](packages/node/src/swarm.ts) — a pure function that runs
before the contract is deployed and returns `{ visibility, ensName, bindSubdomain,
listInOrg }`. Visibility is now an input that decides what gets written, rather than a
label back-derived from what happened to be written. `semi-private` also means something
for the first time: subdomain bound, but kept off the org's discovery list.

Covered by [`swarm-visibility.test.ts`](packages/node/src/swarm-visibility.test.ts).
A second bug turned up while adding the direct-child check: an `--ens-name` more than one
label below the org (`a.b.acme.eth`) made the binder create a subnode at
`keccak(namehash(org) ‖ id("a.b"))` while writing resolver records to
`namehash("a.b.acme.eth")` — two different nodes, so the swarm resolved to nothing and the
org gained a junk subnode. Now rejected.

Remediation for swarms already leaked by the old behaviour ships as `swarm unpublish`:
clears the subdomain's resolver records, releases the subnode, and strips the org-list
label, leaving the contract, the local profile, and membership alone. `--delist-only`
stops at semi-private. `swarm remove --ens-cleanup` — previously a documented no-op — now
performs the same retraction. Note that neither can un-disclose anything: the records were
public on a public chain and the history is permanent.

**Still open from the VPS branch:** it has its own test suite for the visibility/ENS
planning rules. Diff it against `swarm-visibility.test.ts` when porting — it may cover
cases this doesn't.

---

## Integration lane: the e2e suites are non-deterministic against `pnpm denv`

**Root cause, proven — it is the chain harness, not our code.**

anvil auto-mines: a transaction is mined the instant it is submitted, and the chain
then sits idle. ethers' `tx.wait()` resolves off a block-event subscription, so when
the receipt lands *before* the listener is installed there is no subsequent block to
wake it, and `wait()` blocks forever. Evidence, from a hung wait:

```
wait() HUNG.  eth_getTransactionReceipt -> RECEIPT EXISTS block 494;  head=494
              after mining another block, wait() resolved in 126ms
```

Reproduces at ~5% per transaction. Our suites fire ~30 transactions per run, which is
why *exactly one* test stalls per run and it is a different test each time. A stale
provider view of the head also surfaces as a spurious `nonce too low` on a freshly
constructed wallet — same mismatch, second symptom.

**Why this surfaced now: the migration hid the suite, it did not break the chain.**
`org-layer-flow.integration.test.ts` was born at `cli/src/lib/__integration__/`
(5b8c953). From there `../../../test/helpers/` resolved to `cli/test/helpers/` —
correct. The monorepo move relocated it to `packages/node/src/__integration__/`, where
that same path resolves to `packages/test/helpers/`, but the helpers live at
`packages/node/test/helpers/`. Off by one level, so the imports failed to resolve and
the files were never collected — the "No test files found" we kept seeing. The whole
integration lane was dark from the migration until the 15 paths were fixed. These tests
were not passing before; they were not running. Treat every failure the lane is now
showing as pre-existing and newly visible, not as a regression.

**The ethers pin is NOT the cause.** The migration also pinned ethers `^6.16.0` ->
`6.13.1`. Tested head-to-head, 50 sequential transactions each, native anvil:
`6.13.1 hung=0/50 nonceErr=14` vs `6.16.0 hung=0/50 nonceErr=34`. Zero hangs on both,
and the *older* pin is the better one for nonces. Ruled out.

**The hang is specific to the dockerized chain.** It reproduces at ~5% against the
docker anvil on 8545 and not at all against a native `anvil` on another port under an
identical workload. So it is container networking, not ethers and not our code.

**Unit tests cannot see any of this.** No unit test file references `JsonRpcProvider`;
`swarm-visibility.test.ts` has zero mocks because `planSwarmEns()` is pure. A green unit
lane says nothing about the chain lane.

**`cacheTimeout: -1` is confirmed, not inferred.** Same workload, same version:
`default cache -> nonceErr=14`, `cacheTimeout:-1 -> nonceErr=0`.

**Two hypotheses were tested and disproved**, recorded so they are not retried:
- *Provider churn / leaked pollers.* Measured at 1.1x, ~1.75ms per call. A single
  undestroyed provider does not hold the event loop open either. Not the cause.
- *Nonce races between independently constructed signers.* The stall reproduces
  identically with one shared provider and one shared wallet (3 hangs in 40).

**`--block-time 1` is NOT the fix — it breaks the harness.** Tried and reverted.
`ens-test-env`'s anvil entrypoint does take `$ANVIL_EXTRA_ARGS`, so
`ANVIL_EXTRA_ARGS="--block-time 1" pnpm denv` does reach anvil — but startup then never
completes. `manager.js:waitForENSNode()` blocks until the indexer reports
`_meta.block.number >= <deploy block>`; with the chain advancing on a timer, ponder's
historical sync finishes at genesis and its status keeps coming back `null`/`0`
(`ZodError: Too small: expected number to be >=1`), so the wait loop spins forever on
`ENSNode at blockheight: 0, need 12` while anvil marches past block 37. The harness
assumes the chain only advances when a transaction is sent. Do not retry this.

**Fix — library side, two parts.** Both mechanisms confirmed in the ethers v6.13.1
source, not inferred:

1. *The hung wait.* Replace the 28 `await tx.wait()` calls in `packages/node/src` with a
   `waitForTx()` that polls `eth_getTransactionReceipt` directly instead of relying on
   the block-event subscription. Worth doing for real networks (0G, Sepolia) regardless.

2. *The stale nonce.* Construct providers with `{ cacheTimeout: -1 }`.
   `getTransactionCount` routes through `AbstractProvider.#perform`, which by default
   serves any identical request from a 250ms cache (`abstract-provider.js:155,246`). On
   a local chain transactions land well inside 250ms, so a fresh wallet can read a stale
   nonce and get `nonce too low`. `cacheTimeout < 0` bypasses the cache entirely
   (`abstract-provider.js:246-248`).

Part 1 alone is insufficient — it does not address symptom 2.

**This affects the Speculos and Ledger suites too.** They never touch `ens.ts`, but
`global-setup-speculos.ts` probes the same `SOULVAULT_RPC_URL`, and every privileged
operation they exercise goes through the same lib `.wait()` calls. Expect the same ~5%
per-transaction stall there until the block cadence is fixed.

---

## The rest

| # | Feature | State |
|---|---------|-------|
| 1 | `organization fund-agent` / `fund-swarm` — direct native transfers to member wallets across 0G / Ethereum / ENS lanes, recipient filtering, `--dry-run`, funding history on the org profile | Missing entirely. `treasury deposit/withdraw` is a different mechanism (moves value in/out of the treasury *contract*). |
| 2 | Separate admin / agent signers | Missing entirely. No `SOULVAULT_ADMIN_*` in the config zod schema, no `adminSigner`, no role-keyed Ledger cache. `signer.ts` exports one `createSigner()`; `approve-join`, `backup-request`, `epoch rotate`, `register-ens`, and wallet funding all use it. |
| 3 | `swarm member-file-mapping` — latest `MemberFileMappingUpdated` for a member, returning locator / epoch / hashes / tx / updater | Missing. The event is in the ABI ([`swarm-contract.ts:33`](packages/node/src/swarm-contract.ts)) and surfaces in generic `swarm events list`, but there's no per-member resolver. |
| 4 | Backup insufficient-funds handling + shared error helper across `backup.ts` and `backup-respond.ts` | Missing. No underfunded-wallet detection in either, so manual backup and the watcher path can diverge. |
| 5 | Status output: ops RPC vs ENS RPC/chain, manifest + ERC-8004 metadata, explicit "contract authoritative / ENS advisory" framing | Missing from [`status.ts`](packages/node/src/status.ts). |
| 6 | Richer profiles: public manifest URI/hash; swarm ERC-8004 registry + agent refs; swarm-level split of 0G ops vs Eth/ENS RPC | **Partial.** Org profiles already carry `ethRpcUrl` + `ensRpcUrl` ([`organization.ts:13`](packages/node/src/organization.ts)); swarm profiles don't. Manifest URI/hash absent on both; swarm ERC-8004 refs absent. *(The `manifestHash` in `typed-data.ts` / `backup-respond.ts` is the backup-bundle manifest — unrelated.)* |
| 7 | Swarm-scoped epoch: state that a membership change in one swarm doesn't require sibling rotations | **Partial.** The `epoch` command description already says "Swarm-scoped" and docs use per-swarm phrasing, but the sibling-independence point isn't stated anywhere. |

---

## Porting notes

**#2 is the one that will fight the rebase.** The 47 commits added Ledger clear-signing with
EIP-712 typed data and role-keyed client caching. The admin-signer work has to be
re-derived against that, not replayed — expect to touch `signer.ts`, the `config.ts` zod
schema, `clear-sign-modes.ts`, and every admin call site.

Everything else is mostly additive against the current layout: logic into
`packages/node/src/`, thin handlers in `apps/cli/src/commands/`.

Per [`CLAUDE.md`](CLAUDE.md), any new CLI command also needs
`skills/soulvault/references/commands.md` updated — that file is the agent-facing source
of truth and is easy to forget.
