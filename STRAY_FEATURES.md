# Stray features — VPS working tree, not yet on main

A CLI feature set (~604 insertions / 94 deletions across 19 files + 1 new test) sits
uncommitted on a VPS checkout based on `df1a7c1`. That base is **47 commits behind**
`origin/main`, which has since landed the treasury system, ENSIP-11 discovery,
EIP-712 clear-signing, the monorepo restructure, and `apps/web`.

**This needs a port, not a pull.** The signer, ENS, organization, and swarm modules all
moved. Audited against `e7d23c5`; every item below is confirmed absent.

---

## Do this one first, on its own

### Visibility does not gate ENS binding — live privacy leak

`--private` / `--semi-private` set `visibility` on the profile, but the flag is never
consulted before publishing:

- [`packages/node/src/swarm.ts:87`](packages/node/src/swarm.ts) — `ensName` is derived
  unconditionally via `deriveSwarmEnsName(...)`
- [`packages/node/src/swarm.ts:89`](packages/node/src/swarm.ts) — binds whenever
  `organization?.ensName && ensName && contractAddress`
- [`packages/node/src/swarm.ts:136`](packages/node/src/swarm.ts) — `visibility` is then
  *back-derived* from `ensName`, so it documents the outcome rather than controlling it

Consequence: **a swarm created with `--private` under an org still gets a public ENS
subdomain and is appended to the org's `soulvault.swarms` CBOR list.** "Stealth" today
only means "no `--organization`". No test covers this.

Fix is small and independent of everything else here. The VPS branch has a test suite for
the visibility/ENS planning rules — port that with it.

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
