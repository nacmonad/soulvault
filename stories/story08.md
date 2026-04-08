# Story 08 — Agent requests funds, treasury owner reviews and approves

This story demonstrates the fund-request coordination loop: an active swarm member asks for native 0G, the treasury owner sees the request via the event watcher, and approves (or rejects) it. Funds move in a single transaction on approval.

Goal:
- deploy a treasury for an organization
- bind it to an existing swarm
- have an agent submit a fund request
- run the event watcher to observe both the request and (after approval) the payout
- approve the request as the treasury owner and see funds move
- also demonstrate the reject and cancel paths

This story is meant to be run with **two terminals**.

Prerequisite: **Story 00** (org + swarm + at least one active member) and an `.env` pointing at a chain with funds.

---

## Architecture recap (read this first)

The fund-request flow splits across two contracts:

| Concern | Contract | Who |
|---|---|---|
| "am I an active member?" | `SoulVaultSwarm` | enforced at request time |
| request record + lifecycle | `SoulVaultSwarm` | filed by member, marked by treasury callback |
| funds custody + payout | `SoulVaultTreasury` | owned by org admin, releases value on approval |

The treasury is **org-scoped** (one per organization), deployed on 0G Galileo, discovered via ENS text records `soulvault.treasuryContract` + `soulvault.treasuryChainId` on the org's root ENS name on Sepolia. A swarm opts in to a treasury via `swarm set-treasury`; the treasury verifies mutual consent (`swarm.treasury() == address(this)`) before releasing any funds.

---

## 0) One-time setup (once per organization)

### Deploy the treasury
Run as the treasury owner (typically the org admin — in single-operator setups this is also the swarm owner).

```bash
soulvault treasury create --organization <orgNameOrEns>
```

Behavior:
- deploys a fresh `SoulVaultTreasury` on the ops chain (0G Galileo)
- if the org has a registered ENS name, writes `soulvault.treasuryContract` and `soulvault.treasuryChainId` as text records on it
- saves the treasury profile to `~/.soulvault/treasuries/<orgSlug>.json`

On a **Ledger**, expect two or three signing prompts: one for the treasury deployment (0G Galileo tx), then one or two for the ENS text record writes (Sepolia txs).

### Fund the treasury
```bash
soulvault treasury deposit --amount 5 --organization <orgNameOrEns>
```

Sends 5 native tokens from your signer wallet into the treasury. Any wallet can deposit (not just the owner), so in a team setup the funder and the approver can be different people.

### Bind the swarm to the treasury
Run as the swarm owner (same wallet as the treasury owner in a single-operator setup, different wallet in a multi-team org).

```bash
soulvault swarm set-treasury --swarm ops --treasury <treasuryContractAddress>
```

Behavior:
- calls `setTreasury(address)` on the swarm contract
- refreshes the local swarm profile's cached `treasuryAddress`
- emits `TreasurySet(oldTreasury, newTreasury, by)` on chain

If there are any pending fund requests at the time of re-binding, the CLI prints a warning — those requests will be orphaned from the previous treasury.

Verify the binding:
```bash
soulvault swarm treasury-status --swarm ops
```

Expected output includes `"isSet": true` and the treasury address.

---

## Terminal 2 (start first) — Treasury owner watches events

```bash
soulvault swarm events watch --swarm ops
```

Leave this running. It polls the swarm contract AND the bound treasury contract every 5 seconds and prints every new event in a single merged stream, ordered by `(blockNumber, logIndex)` so that the `FundRequestApproved` (swarm) and `FundsReleased` (treasury) events for a single approval tx render in the correct order.

Each event line is tagged with a `"source"` field (`"swarm"` or `"treasury"`).

---

## Terminal 1 — Agent files a fund request

As an **active swarm member** (different wallet from the swarm owner in a typical setup — swap `SOULVAULT_PRIVATE_KEY` in your env or use a separate profile):

```bash
soulvault swarm fund-request --swarm ops --amount 1 --reason "inference credit top-up"
```

Behavior:
- calls `requestFunds(amount, reason)` on the swarm contract
- contract checks: caller is active member, treasury is bound, amount > 0, not paused
- emits `FundRequested(requestId, requester, amount, reason)`
- CLI parses the receipt and prints `requestId`

Expected output includes `"requestId": "<N>"` — note this down for the next step.

---

## Terminal 2 — Treasury owner observes the request

The watcher in Terminal 2 should show a new event within the next poll cycle:

```json
{
  "source": "swarm",
  "type": "FundRequested",
  "requestId": "1",
  "requester": "0x...",
  "amountWei": "1000000000000000000",
  "reason": "inference credit top-up"
}
```

You can also query directly at any time:

```bash
soulvault swarm fund-requests list --swarm ops --status pending
```

or from the treasury-owner perspective:

```bash
soulvault treasury fund-requests list --swarm ops --status pending --organization <orgNameOrEns>
```

Both commands return the same data — they just reflect the two perspectives (requester vs approver).

---

## Terminal 2 — Treasury owner approves the request

Still as the treasury owner:

```bash
soulvault treasury approve-fund --swarm ops --request-id 1 --organization <orgNameOrEns>
```

Behavior:
- verifies mutual consent: `ISoulVaultSwarm(ops).treasury() == <this treasury address>`
- reads the fund request from the swarm, checks status == PENDING and treasury balance >= amount
- calls `swarm.markFundRequestApproved(requestId)` which flips the swarm-side status atomically
- transfers the requested amount to the original requester via native-value `.call`
- emits `FundsReleased(swarm, requestId, recipient, amount)` on the treasury and `FundRequestApproved` on the swarm

On a **Ledger**, expect a signing prompt for the 0G approval transaction.

Expected CLI output includes `"recipient"`, `"amountWei"`, and the tx hash.

Within the next watcher poll cycle, Terminal 2 should print both events from the same block in the correct order:

```json
{"source":"swarm","type":"FundRequestApproved", "requestId":"1", ...}
{"source":"treasury","type":"FundsReleased", "requestId":"1", ...}
```

---

## Verification

### Check the fund request status
```bash
soulvault swarm fund-status --swarm ops --request-id 1
```

Expected: `"statusLabel": "approved"`, non-zero `resolvedAt`.

### Check the agent's on-chain balance
The agent's wallet should have gone up by ~1 native token (the approval tx is paid by the treasury owner, so the agent doesn't pay gas for the payout).

### Check the treasury balance
```bash
soulvault treasury status --organization <orgNameOrEns>
```

Expected: balance decreased by exactly 1 native token from the deposit amount.

---

## Reject path

If the treasury owner doesn't want to approve, they reject with a reason:

```bash
soulvault treasury reject-fund --swarm ops --request-id 2 --reason "out of budget this week" --organization <orgNameOrEns>
```

Behavior:
- mutual consent check
- calls `swarm.markFundRequestRejected(requestId, reason)`
- emits `FundRequestRejected` (swarm) and `FundRequestRejectedByTreasury` (treasury)
- **no funds move**

---

## Cancel path (requester-only)

An agent can withdraw a pending request before it's been approved or rejected:

```bash
soulvault swarm cancel-fund-request --swarm ops --request-id 3
```

Requirements: caller must be the original requester, request must still be PENDING.

Effects: status flips to CANCELLED. A subsequent approve attempt from the treasury will revert (the treasury short-circuits on `InvalidRequestState` when it reads the request and sees it's not PENDING).

---

## Important failure modes

### Insufficient treasury balance
If the treasury doesn't have enough to cover the request, the approve tx reverts atomically with `InsufficientBalance`:

```text
Error: execution reverted (custom error: InsufficientBalance)
```

The swarm-side request stays PENDING — the revert unwinds the swarm's status flip as well. Top up the treasury with `soulvault treasury deposit --amount <n>` and retry.

### Swarm paused mid-flow
If the swarm owner pauses the swarm between the request being filed and the approval, the treasury's call to `markFundRequestApproved` reverts with `PausedError` (propagated from the swarm's `whenNotPaused` modifier). Treasury state is unchanged, the request stays PENDING, and retry works after `unpause`.

**Note on pause UX:** the contract has `pause()` and `unpause()` functions, but they are not currently exposed as CLI commands — the `SOULVAULT_SWARM_ABI` in `cli/src/lib/swarm-contract.ts` does not list them. To exercise pause during testing today you have to use ethers directly or `cast send <swarm> "pause()"`. This is tracked as a follow-up (see `contracts/IMPLEMENTATION_NOTES.md`).

### Mutual consent mismatch
If a treasury tries to approve a request for a swarm that is bound to a DIFFERENT treasury (or no treasury at all), the tx reverts with `SwarmTreasuryMismatch`. This is the on-chain authorization gate that makes the "org-scoped single treasury" model work.

### Treasury rebinding orphans pending requests
If a swarm owner changes the treasury via `setTreasury` while fund requests are still PENDING, those requests become orphaned from the old treasury (which can no longer approve them because its mutual-consent check now fails) but are still approvable by the NEW treasury. The CLI `swarm set-treasury` command prints a warning when pending requests exist at rebind time.

---

## Notes on architecture

- **The swarm enforces membership, the treasury enforces funds.** This split is deliberate: validation belongs where validated state lives. A non-member can't even FILE a request — the swarm reverts at `requestFunds` time, long before the treasury ever sees it.
- **Mutual consent** (`swarm.treasury() == address(this)`) is the on-chain authorization gate. Neither contract can unilaterally bind the other. The swarm owner opts in by calling `setTreasury`; the treasury owner opts in to each individual request by signing the approve tx.
- **The treasury owner is the rate limiter in v1.** There are no on-chain spending caps, no time-window limits, no allowance tracking. If you need those, they're a clean follow-up — add a `swarmAllowance` mapping and a check in `approveFundRequest`.
- **Native only for v1.** The `FundRequest` struct does not have a `token` field. ERC-20 support is a v2 struct migration, not a field addition.
- **Treasury owner and swarm owner can be the same wallet** (single-operator setups) or different wallets (multi-team orgs where the org admin holds the treasury keys and swarm owners are team leads). Both are valid; neither requires a code change.

---

## Future features flagged during this build

The following items are documented in `contracts/IMPLEMENTATION_NOTES.md` as follow-ups. They are **not** implemented in this branch but are on the roadmap:

1. **`soulvault swarm pause` / `unpause` CLI commands.** The contract already has pause/unpause (and Foundry tests cover them), but the CLI ABI and command surface don't expose them yet. A dedicated `feat/cli-swarm-pause` branch adds the two ABI fragments + two commands.
2. **Organization-level pause.** No atomic way to halt an entire org's swarms + treasury with a single signature today, because the Organization entity is not a smart contract. Multiple design options (on-chain Organization contract, treasury-propagated pause, off-chain scripted). Deferred as a design question.
3. **Constructor-time treasury binding.** `SoulVaultSwarm.constructor()` currently takes no arguments; treasury is always bound post-deploy. A non-breaking follow-up can add an optional `constructor(address initialTreasury)` for single-tx deploys when the treasury address is known in advance (e.g. via CREATE2).
4. **ERC-20 fund requests.** Native-only today; a new `FundRequestV2` struct + new counter would add token support.
5. **Per-swarm spending caps / rate limits** on the treasury.
6. **ABI regeneration from forge artifacts** instead of hand-maintained fragments in `swarm-contract.ts` / `treasury-contract.ts`.
