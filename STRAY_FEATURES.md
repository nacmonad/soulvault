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

**Two hypotheses were tested and disproved**, recorded so they are not retried:
- *Provider churn / leaked pollers.* Measured at 1.1x, ~1.75ms per call. A single
  undestroyed provider does not hold the event loop open either. Not the cause.
- *Nonce races between independently constructed signers.* The stall reproduces
  identically with one shared provider and one shared wallet (3 hangs in 40).

**Fix — harness, not library.** Give the dev chain a steady block cadence
(`anvil --block-time 1`, set in ens-app-v3's `pnpm denv` compose config). That fixes
both symptoms for every suite at once with no code change.

A library-side `waitForTx()` that polls `eth_getTransactionReceipt` instead of relying
on the subscription would fix the hang across all 28 `.wait()` call sites in
`packages/node/src`, and is worth doing anyway for real networks — but on its own it is
**not sufficient**, because it does not address the stale-nonce symptom.

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
