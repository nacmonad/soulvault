# Story 08 — Fund requests, organization pause, and the Organization → Swarm hierarchy

This story demonstrates the fund-request coordination loop and the organization-level pause: an active swarm member asks for native 0G, the organization owner sees the request via the event watcher, and approves (or rejects) it. Funds move in a single transaction on approval. The org owner can also freeze *all* swarm operations with a single `pauseOrg` call.

Goal:
- deploy an organization contract for your org
- register a swarm on the organization
- bind the swarm to the organization
- have an agent submit a fund request
- run the event watcher to observe both the request and (after approval) the payout
- approve the request as the organization owner and see funds move
- demonstrate the reject and cancel paths
- demonstrate org-level pause freezing all swarm operations, then unpause to resume

This story is meant to be run with **two terminals**.

Prerequisite: **Story 00** (org + swarm + at least one active member) and an `.env` pointing at a chain with funds.

---

## Architecture recap (read this first)

The fund-request flow splits across two contracts:

| Concern | Contract | Who |
|---|---|---|
| "am I an active member?" | `SoulVaultSwarm` | enforced at request time |
| request record + lifecycle | `SoulVaultSwarm` | filed by member, marked by organization callback |
| swarm registry + funds custody + payout | `SoulVaultOrganization` | owned by org admin, releases value on approval |
| org-level pause (freezes all swarms) | `SoulVaultOrganization` | single SSTORE, checked by every swarm operation |

The organization contract is **org-scoped** (one per organization), deployed on 0G Galileo, discovered via ENS text records `soulvault.orgContract` + `soulvault.orgChainId` on the org's root ENS name on Sepolia. A swarm opts in to an organization via `swarm set-organization`; the org owner registers the swarm via `organization register-swarm`. Both sides must agree (mutual consent) before funds can flow.

---

## 0) One-time setup (once per organization)

### Deploy the organization contract
Run as the org owner.

```bash
soulvault organization deploy --organization <orgNameOrEns>
```

Behavior:
- deploys a fresh `SoulVaultOrganization` on the ops chain (0G Galileo)
- if the org has a registered ENS name, writes `soulvault.orgContract` and `soulvault.orgChainId` as text records on it
- saves the contract profile to `~/.soulvault/treasuries/<orgSlug>.json`

Optional ERC-4824 metadata (can also be set later with `organization set-metadata`):
```bash
soulvault organization deploy --organization <orgNameOrEns> \
  --dao-uri "https://example.com/dao.json" \
  --governance-uri "ipfs://Qm.../governance.md"
```

On a **Ledger**, expect two or three signing prompts: one for the contract deployment (0G Galileo tx), then one or two for the ENS text record writes (Sepolia txs).

### Fund the organization
```bash
soulvault organization deposit --amount 5 --organization <orgNameOrEns>
```

Sends 5 native tokens from your signer wallet into the organization. Any wallet can deposit (not just the owner), so in a team setup the funder and the approver can be different people.

### Register the swarm on the organization
Run as the org owner.

```bash
# Note the swarm's contract address (from `soulvault swarm status --swarm ops`)
soulvault organization register-swarm --swarm <swarmContractAddress> --organization <orgNameOrEns>
```

This adds the swarm to the org's on-chain registry. The org will only process fund requests from registered swarms.

### Bind the swarm to the organization
Run as the swarm owner (same wallet as the org owner in a single-operator setup, different wallet in a multi-team org).

```bash
soulvault swarm set-organization --swarm ops --organization <orgContractAddress>
```

Behavior:
- calls `setOrganization(address)` on the swarm contract
- refreshes the local swarm profile's cached `organizationAddress`
- emits `OrganizationSet(oldOrganization, newOrganization, by)` on chain

If there are any pending fund requests at the time of re-binding, the CLI prints a warning — those requests will be orphaned from the previous organization.

Verify the binding:
```bash
soulvault swarm organization-status --swarm ops
```

Expected output includes `"isSet": true` and the organization address.

---

## Terminal 2 (start first) — Organization owner watches events

```bash
soulvault swarm events watch --swarm ops
```

Leave this running. It polls the swarm contract AND the bound organization contract every 5 seconds and prints every new event in a single merged stream, ordered by `(blockNumber, logIndex)` so that the `FundRequestApproved` (swarm) and `FundsReleased` (organization) events for a single approval tx render in the correct order.

Each event line is tagged with a `"source"` field (`"swarm"` or `"organization"`).

---

## Terminal 1 — Agent files a fund request

As an **active swarm member** (different wallet from the swarm owner in a typical setup — swap `SOULVAULT_PRIVATE_KEY` in your env or use a separate profile):

```bash
soulvault swarm fund-request --swarm ops --amount 1 --reason "inference credit top-up"
```

Behavior:
- calls `requestFunds(amount, reason)` on the swarm contract
- contract checks: caller is active member, organization is bound, amount > 0, not paused (swarm-level AND org-level)
- emits `FundRequested(requestId, requester, amount, reason)`
- CLI parses the receipt and prints `requestId`

Expected output includes `"requestId": "<N>"` — note this down for the next step.

---

## Terminal 2 — Organization owner observes the request

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

or from the org-owner perspective:

```bash
soulvault organization fund-requests list --swarm ops --status pending --organization <orgNameOrEns>
```

Both commands return the same data — they just reflect the two perspectives (requester vs approver).

---

## Terminal 2 — Organization owner approves the request

Still as the organization owner:

```bash
soulvault organization approve-fund --swarm ops --request-id 1 --organization <orgNameOrEns>
```

Behavior:
- verifies the swarm is registered on the org (`isSwarm(swarm)`)
- verifies mutual consent: `ISoulVaultSwarm(ops).organization() == <this org address>`
- reads the fund request from the swarm, checks status == PENDING and org balance >= amount
- calls `swarm.markFundRequestApproved(requestId)` which flips the swarm-side status atomically
- transfers the requested amount to the original requester via native-value `.call`
- emits `FundsReleased(swarm, requestId, recipient, amount)` on the org and `FundRequestApproved` on the swarm

On a **Ledger**, expect a signing prompt for the 0G approval transaction.

Expected CLI output includes `"recipient"`, `"amountWei"`, and the tx hash.

Within the next watcher poll cycle, Terminal 2 should print both events from the same block in the correct order:

```json
{"source":"swarm","type":"FundRequestApproved", "requestId":"1", ...}
{"source":"organization","type":"FundsReleased", "requestId":"1", ...}
```

---

## Verification

### Check the fund request status
```bash
soulvault swarm fund-status --swarm ops --request-id 1
```

Expected: `"statusLabel": "approved"`, non-zero `resolvedAt`.

### Check the agent's on-chain balance
The agent's wallet should have gone up by ~1 native token (the approval tx is paid by the org owner, so the agent doesn't pay gas for the payout).

### Check the organization balance
```bash
soulvault organization status --organization <orgNameOrEns>
```

Expected: balance decreased by exactly 1 native token from the deposit amount.

---

## Reject path

If the organization owner doesn't want to approve, they reject with a reason:

```bash
soulvault organization reject-fund --swarm ops --request-id 2 --reason "out of budget this week" --organization <orgNameOrEns>
```

Behavior:
- swarm registry + mutual consent check
- calls `swarm.markFundRequestRejected(requestId, reason)`
- emits `FundRequestRejected` (swarm) and `FundRequestRejectedByOrganization` (organization)
- **no funds move**

---

## Cancel path (requester-only)

An agent can withdraw a pending request before it's been approved or rejected:

```bash
soulvault swarm cancel-fund-request --swarm ops --request-id 3
```

Requirements: caller must be the original requester, request must still be PENDING.

Effects: status flips to CANCELLED. A subsequent approve attempt from the organization will revert (the organization short-circuits on `InvalidRequestState` when it reads the request and sees it's not PENDING).

---

## Organization-level pause — freeze everything with one transaction

The org owner can halt *all* operations across *every* swarm in the organization with a single `pauseOrg` call. This is the "checked flag" pattern (Option B): the org contract stores one boolean, and every swarm checks it in its `whenNotPaused` modifier via a STATICCALL to `orgPaused()`.

### Pause the org

```bash
# As the org owner — this could be via cast or a future `organization pause` CLI command:
cast send <orgContractAddress> "pauseOrg()" --private-key <orgOwnerKey> --rpc-url <rpc>
```

### Try to file a fund request (should fail)

```bash
soulvault swarm fund-request --swarm ops --amount 1 --reason "should fail"
```

Expected: revert with `OrgPausedError`. The swarm's `whenNotPaused` modifier checks `ISoulVaultOrganization(organization).orgPaused()` before executing any gated operation — including `requestJoin`, `requestFunds`, `cancelFundRequest`, `rotateEpoch`, `postMessage`, etc.

### Try to approve a pending request from the org side (also fails)

```bash
soulvault organization approve-fund --swarm ops --request-id 1 --organization <orgNameOrEns>
```

Expected: revert with `OrgIsPaused`. The organization contract's own `whenOrgNotPaused` modifier blocks approvals and rejections while paused.

### Unpause

```bash
cast send <orgContractAddress> "unpauseOrg()" --private-key <orgOwnerKey> --rpc-url <rpc>
```

### Resume operations

```bash
soulvault swarm fund-request --swarm ops --amount 1 --reason "post-unpause"
```

Expected: succeeds. The swarm reads `orgPaused() == false` and allows the operation.

### Why this matters

- **One SSTORE freezes everything.** No need to iterate and pause each swarm individually.
- **No gaps.** A new swarm registered *after* the pause inherits the frozen state immediately — the flag is checked at call time, not at registration time.
- **Separation of concerns.** The swarm's own `pause()` / `unpause()` still works independently. A swarm can be paused while the org is not, and vice versa. Both checks are in the same modifier.

---

## Important failure modes

### Insufficient organization balance
If the organization doesn't have enough to cover the request, the approve tx reverts atomically with `InsufficientBalance`:

```text
Error: execution reverted (custom error: InsufficientBalance)
```

The swarm-side request stays PENDING — the revert unwinds the swarm's status flip as well. Top up with `soulvault organization deposit --amount <n>` and retry.

### Swarm paused mid-flow
If the swarm owner pauses the swarm between the request being filed and the approval, the organization's call to `markFundRequestApproved` reverts with `PausedError` (propagated from the swarm's `whenNotPaused` modifier). Organization state is unchanged, the request stays PENDING, and retry works after `unpause`.

### Org paused mid-flow
Same behavior but from the org side. The organization's `whenOrgNotPaused` modifier blocks `approveFundRequest` and `rejectFundRequest`. The swarm's `whenNotPaused` modifier also blocks member-side operations (`requestFunds`, `cancelFundRequest`). Everything stays PENDING until `unpauseOrg`.

### Swarm not registered
If the organization owner tries to approve a request for a swarm that is NOT in the org's on-chain registry, the tx reverts with `SwarmNotRegistered`. Register the swarm first.

### Mutual consent mismatch
If an organization tries to approve a request for a swarm that is bound to a DIFFERENT organization (or no organization at all), the tx reverts with `SwarmOrganizationMismatch`. This is the on-chain authorization gate that makes the "org-scoped" model work.

### Organization rebinding orphans pending requests
If a swarm owner changes the organization via `setOrganization` while fund requests are still PENDING, those requests become orphaned from the old org (which can no longer approve them because its mutual-consent check now fails) but are still approvable by the NEW organization (assuming the new org has registered the swarm). The CLI `swarm set-organization` command prints a warning when pending requests exist at rebind time.

---

## Notes on architecture

- **The swarm enforces membership, the organization enforces funds.** This split is deliberate: validation belongs where validated state lives. A non-member can't even FILE a request — the swarm reverts at `requestFunds` time, long before the organization ever sees it.
- **Mutual consent** (`isSwarm(swarm) && swarm.organization() == address(this)`) is the on-chain authorization gate. Neither contract can unilaterally bind the other. The swarm owner opts in by calling `setOrganization`; the org owner registers the swarm and opts in to each individual request by signing the approve tx.
- **The organization owner is the rate limiter in v1.** There are no on-chain spending caps, no time-window limits, no allowance tracking. If you need those, they're a clean follow-up — add a `swarmAllowance` mapping and a check in `approveFundRequest`.
- **Native only for v1.** The `FundRequest` struct does not have a `token` field. ERC-20 support is a v2 struct migration, not a field addition.
- **Org owner and swarm owner can be the same wallet** (single-operator setups) or different wallets (multi-team orgs where the org admin holds the org keys and swarm owners are team leads). Both are valid; neither requires a code change.
- **Org-level pause is the checked-flag pattern.** One boolean on the org, read by every swarm via STATICCALL (~2.6k gas on a warm slot). No iteration, no gaps, no race conditions.

---

## Future features flagged during this build

The following items are documented in `contracts/IMPLEMENTATION_NOTES.md` as follow-ups. They are **not** implemented in this branch but are on the roadmap:

1. **`soulvault organization pause` / `unpause` CLI commands.** The contract already has `pauseOrg()` / `unpauseOrg()` and Foundry tests cover them. Adding CLI commands is a clean follow-up.
2. **`soulvault swarm pause` / `unpause` CLI commands.** Same situation — contract has them, CLI doesn't expose them yet.
3. **Constructor-time organization binding.** `SoulVaultSwarm.constructor()` currently takes no arguments; organization is always bound post-deploy. A non-breaking follow-up can add an optional `constructor(address initialOrganization)`.
4. **ERC-20 fund requests.** Native-only today; a new `FundRequestV2` struct + new counter would add token support.
5. **Per-swarm spending caps / rate limits** on the organization.
6. **ABI regeneration from forge artifacts** instead of hand-maintained fragments in `swarm-contract.ts`.
