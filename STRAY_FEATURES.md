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

## Integration lane: non-determinism — RESOLVED

`pnpm test:integration` is 21/21 green against a stock `pnpm denv`. Two bugs, both in
our own test setup. Everything else investigated was a dead end; the disproved theories
are kept at the bottom so they are not retried.

### Bug 1 — the Vitest 4 upgrade silently dropped serialization

Both integration configs asked for serialization with
`poolOptions.threads.singleThread`. Vitest 4 removed `poolOptions` and ignores it with
only a deprecation notice, so the files started running concurrently. That breaks two
invariants: global setup mutates `process.env.HOME` (the config's own comment says so),
and every file drives the same signer EOA against the same chain.

Fixed with `fileParallelism: false` + `maxWorkers`/`minWorkers`. The speculos config
already carried `fileParallelism: false`, which is why that lane was never affected.

### Bug 2 — `deployContract` pinned deploys to a stale nonce

`test/helpers/forge-artifacts.ts` pinned an explicit nonce, with a comment claiming it
forced a fresh read. It did neither:

- it read `'latest'`, which counts only *mined* transactions, so anything still in the
  pool was invisible — and it then pinned the deploy to that number;
- the read was not fresh, because `getTransactionCount` routes through ethers' 250ms
  request cache and back-to-back deploys land well inside that window.

Fixed by reading `'pending'` and adding `makeTestProvider()`, which builds providers with
`cacheTimeout: -1`. Measured, 50 sequential transactions from one wallet on a local
anvil: default cache 14 `NONCE_EXPIRED`, `cacheTimeout: -1` zero.

**This single bug produced both symptoms.** A pinned nonce below the real one throws
`NONCE_EXPIRED`; one above it leaves the transaction queued in the pool, unmined, so its
`tx.wait()` never resolves — the "hang" that looked like an ethers or networking problem.
Which symptom appeared depended on which side of the real nonce the stale read fell, and
that is why it looked random.

It was also a large silent tax on runtime. After the fix, on the same chain:
`wires swarm -> treasury` 4195ms -> 119ms, `receives native value` 4208ms -> 120ms,
`cancel path` 8884ms -> 304ms. Those transactions had been waiting behind bad nonces.

### Disproved — do not retry

- **`anvil --block-time 1`.** Actively breaks the harness. `ANVIL_EXTRA_ARGS` does reach
  anvil, but `manager.js:waitForENSNode()` blocks until the indexer reports
  `_meta.block.number >= <deploy block>`; with the chain advancing on a timer ponder's
  historical sync finishes at genesis and its status keeps returning `null`/`0`
  (`ZodError: Too small: expected number to be >=1`), so startup spins forever on
  `ENSNode at blockheight: 0, need 12`. ens-test-env assumes the chain only advances when
  a transaction is sent.
- **A provider leak / churn in `ens.ts`.** Measured at 1.1x, ~1.75ms per call. An
  undestroyed provider does not hold the event loop open either.
- **The ethers pin (`^6.16.0` -> `6.13.1`, from the monorepo commit).** Head-to-head, 50
  sequential transactions on a native anvil: `6.13.1 hung=0/50 nonceErr=14` vs
  `6.16.0 hung=0/50 nonceErr=34`. Zero hangs on both; the older pin is better for nonces.
- **Docker networking.** Plausible while the hang would not reproduce on a native anvil,
  but fully explained by Bug 2 once the nonce pinning was fixed.

### The migration's real effect: it hid the lane

`org-layer-flow.integration.test.ts` was born at `cli/src/lib/__integration__/`
(5b8c953), where `../../../test/helpers/` resolved to `cli/test/helpers/`. The monorepo
move relocated it to `packages/node/src/__integration__/`, where that same path points at
`packages/test/helpers/` while the helpers live at `packages/node/test/helpers/`. Off by
one level, imports unresolvable, files never collected — the "No test files found" we kept
hitting. The lane was dark from the migration until the 15 paths were fixed, so both bugs
above were pre-existing and merely invisible. Unit tests could never have caught them:
no unit test file references `JsonRpcProvider`.

### Still open: the lane takes ~7 minutes

Nothing calls `evm_increaseTime`/`evm_mine`. `ens-name.ts:191` genuinely sleeps
`minCommitmentAge + 1` seconds in wall-clock, so a single org-layer-flow test burns ~130s.
On a local chain that wait can be skipped by advancing chain time instead of sleeping,
which would cut minutes off the run.


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
