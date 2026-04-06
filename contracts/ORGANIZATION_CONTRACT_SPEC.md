# SoulVault Organization Contract Spec

## Purpose

`SoulVaultOrganization` is the **org-scoped coordination and payout layer** for agent swarms. One organization contract is deployed per organization on 0G Galileo. It holds native value (0G), manages a registry of authorized swarms, provides an org-level pause, and releases funds when the organization owner approves a pending fund request filed on a registered swarm.

It is **not** responsible for:
- validating swarm membership (the swarm does that at request time)
- storing the fund request lifecycle (the swarm holds the authoritative state)
- ERC-20 tokens (v1 is native-only)
- spending caps or rate-limits (v1 relies on the organization owner as the rate limiter)

The organization contract is discoverable via ENS text records on the organization's root ENS name:
- `soulvault.orgContract` → deployed organization contract address
- `soulvault.orgChainId` → chain id where the organization contract lives (0G Galileo = `16602`)

---

## State split with SoulVaultSwarm

The fund-request flow is deliberately split across two contracts:

| Concern | Contract |
|---|---|
| Membership check (requester must be active) | `SoulVaultSwarm` |
| Request record + lifecycle (PENDING → APPROVED/REJECTED/CANCELLED) | `SoulVaultSwarm` |
| Funds custody + payout execution | `SoulVaultOrganization` |
| Organization owner authorization | `SoulVaultOrganization` |

**Mutual consent:** the organization contract only accepts approvals for swarms that are registered via `registerSwarm(swarm)` and that have explicitly opted in by calling `swarm.setOrganization(<this organization address>)`. Every `approveFundRequest` / `rejectFundRequest` call verifies `isSwarm(swarm)` and `ISoulVaultSwarm(swarm).organization() == address(this)`, reverting with `SwarmNotRegistered` or `SwarmOrganizationMismatch` otherwise. Neither side can unilaterally bind the other.

---

## Roles

### Owner
The deployer. Immutable, set in `constructor()` from `msg.sender`. Can:
- register / remove swarms
- approve / reject fund requests on registered swarms
- withdraw native value from the organization contract
- pause / unpause the organization (org-level pause)
- (implicitly) deploy and hold the organization contract

Single-signer in v1. Multisig support would require either re-deploying behind a multisig wallet or a follow-up refactor.

### Public / anyone
Can:
- deposit native value (`receive()` or `deposit()`) — deposits are open to anyone so funders don't need to be the owner

---

## Core State

### Globals
- `owner` — immutable, set at deployment to `msg.sender`
- `_locked` — internal reentrancy guard (1 = free, 2 = entered)
- `orgPaused` — org-level pause flag (default `false`)
- `_swarms` — internal set of registered swarm addresses (EnumerableSet or equivalent)

The organization contract holds NO fund-request records of its own. It reads them from the swarm contract at approval time.

---

## Method Semantics

### `receive()` / `deposit()`

Both accept native value and emit `FundsDeposited(from, amount)`. The two entry points exist so depositors can either send value via a plain transfer (`receive()`) or call the named function explicitly.

### `approveFundRequest(address swarm, uint256 requestId)` — `onlyOwner nonReentrant`

The core of the feature. Executes in four steps:

1. **Swarm registration + mutual consent check:** `isSwarm(swarm)` else `SwarmNotRegistered`; `ISoulVaultSwarm(swarm).organization() == address(this)` else `SwarmOrganizationMismatch`.
2. **Read request:** `ISoulVaultSwarm(swarm).getFundRequest(requestId)`. Reverts with `InvalidFundRequest` if the record is empty, `InvalidRequestState` if not PENDING, `InsufficientBalance` if `address(this).balance < req.amount`.
3. **Effect (before interaction):** `ISoulVaultSwarm(swarm).markFundRequestApproved(requestId)`. Flips the swarm-side status to APPROVED atomically. The swarm's own callback check enforces `msg.sender == organization`.
4. **Interaction:** native value transfer to `req.requester` via `.call{value}("")`. Reverts with `TransferFailed` on recipient revert.

Emits `FundsReleased(swarm, requestId, recipient, amount)` on success.

**Reentrancy:** checks-effects-interactions ordering plus an inline `nonReentrant` modifier. Any reentry attempt via a malicious `receive()` on the requester contract will revert on the swarm-side `InvalidFundRequestState` guard because the status was already flipped in step 3. The `nonReentrant` lock is belt-and-braces.

**Paused swarm:** `markFundRequestApproved` is `whenNotPaused` on the swarm side (which also checks the org-level pause via `ISoulVaultOrganization(organization).orgPaused()`). A paused swarm or a paused organization will cause the call to revert atomically. Organization-side state is unchanged. The request stays PENDING and can be re-approved after `unpause`.

### `rejectFundRequest(address swarm, uint256 requestId, string reason)` — `onlyOwner`

Calls `ISoulVaultSwarm(swarm).markFundRequestRejected(requestId, reason)` after the mutual-consent check. No funds move. Emits `FundRequestRejectedByOrganization(swarm, requestId, reason)` in addition to the swarm-side `FundRequestRejected` event.

### `withdraw(address payable to, uint256 amount)` — `onlyOwner nonReentrant`

Owner drains value from the organization contract. Reverts on zero address, insufficient balance, or transfer failure. Emits `OrganizationWithdrawn(to, amount)`.

### `balance() view returns (uint256)`

Returns `address(this).balance`. Convenience view for CLI / off-chain status checks.

---

## Swarm Registry

The organization contract maintains a registry of authorized swarms. Only registered swarms can have their fund requests approved or rejected.

### `registerSwarm(address swarm)` — `onlyOwner`

Adds a swarm to the registry. Reverts if the swarm is already registered or if `swarm == address(0)`.

Effects:
- adds swarm to the internal set
- emits `SwarmRegistered(swarm)`

### `removeSwarm(address swarm)` — `onlyOwner`

Removes a swarm from the registry. Reverts if the swarm is not registered.

Effects:
- removes swarm from the internal set
- emits `SwarmRemoved(swarm)`

**Pending fund requests:** removing a swarm does NOT automatically cancel its pending fund requests on the swarm side. The owner simply loses the ability to approve/reject them from this organization contract. The requester can still cancel, or the owner can re-register the swarm later.

### `isSwarm(address swarm) view returns (bool)`

Returns whether the given address is a registered swarm.

### `swarms() view returns (address[])`

Returns the full list of registered swarm addresses. Useful for CLI enumeration.

### `swarmCount() view returns (uint256)`

Returns the number of registered swarms.

---

## Org-Level Pause

The organization contract implements an org-level pause flag that propagates to all bound swarms. This is the **Option B checked-flag design**: the organization contract stores a boolean `orgPaused` flag, and each swarm's `whenNotPaused` modifier checks both `swarm.paused` and `ISoulVaultOrganization(organization).orgPaused()`.

### `pauseOrg()` — `onlyOwner`

Sets `orgPaused = true`. Emits `OrgPaused(msg.sender)`. All registered swarms that check this flag will atomically refuse state-mutating operations.

### `unpauseOrg()` — `onlyOwner`

Sets `orgPaused = false`. Emits `OrgUnpaused(msg.sender)`.

### `orgPaused() view returns (bool)`

Returns the current org-level pause state. Called by swarm contracts in their `whenNotPaused` modifier.

**Design rationale (Option B — checked flag):** The organization does NOT iterate over swarms to set their individual pause flags. Instead, each swarm makes a single `STATICCALL` to `organization.orgPaused()` as part of its own pause check. This is cheaper than maintaining a separate pause-per-swarm mapping and avoids the gas-scaling problem of iterating over an unbounded swarm set. The trade-off is one extra external call per gated swarm operation, which is negligible relative to the other cross-contract calls in the fund-request flow.

---

## Events

| Event | Emitted by | Fields |
|---|---|---|
| `FundsDeposited` | `receive()` / `deposit()` | `from` (indexed), `amount` |
| `FundsReleased` | `approveFundRequest` | `swarm` (indexed), `requestId` (indexed), `recipient` (indexed), `amount` |
| `FundRequestRejectedByOrganization` | `rejectFundRequest` | `swarm` (indexed), `requestId` (indexed), `reason` |
| `OrganizationWithdrawn` | `withdraw` | `to` (indexed), `amount` |
| `SwarmRegistered` | `registerSwarm` | `swarm` (indexed) |
| `SwarmRemoved` | `removeSwarm` | `swarm` (indexed) |
| `OrgPaused` | `pauseOrg` | `by` (indexed) |
| `OrgUnpaused` | `unpauseOrg` | `by` (indexed) |

The swarm contract emits its own paired events — see `SWARM_CONTRACT_SPEC.md` §Fund Requests.

---

## Errors

| Error | When |
|---|---|
| `NotOwner` | Any owner-gated method called by non-owner |
| `SwarmNotRegistered` | Swarm address is not in the organization's swarm registry |
| `SwarmOrganizationMismatch` | Swarm's `organization()` doesn't point at this contract |
| `InvalidFundRequest` | Request id doesn't exist (requester is zero) |
| `InvalidRequestState` | Request is not PENDING at read time (cancelled / already resolved) |
| `InsufficientBalance` | Organization balance < requested amount, or < withdraw amount |
| `TransferFailed` | Native-value `.call` returned false |
| `ZeroAddress` | Withdraw recipient is `address(0)` |
| `Reentrant` | Reentrancy guard tripped |

---

## Discovery via ENS

Per the two-lane architecture, the organization contract lives on 0G Galileo but its address is discoverable via ENS text records on Sepolia (on the org's existing root ENS name — no dedicated subdomain). When `soulvault organization create` runs, it writes two text records:

```
soulvault.orgContract = <0G organization contract address>
soulvault.orgChainId  = 16602
```

A downstream consumer that knows the org's ENS name (e.g. `soulvault.eth`) can resolve the organization contract address without any local state. This mirrors the swarm discovery pattern (`soulvault.swarmContract` on the swarm subdomain).

---

## What's deliberately NOT in v1

| Deferred | Reason |
|---|---|
| ERC-20 support | Native-only keeps the contract surface small. `FundRequest` struct is NOT reserved for a `token` field — a future v2 would migrate to a new struct + new mapping. |
| Per-swarm spending caps | Organization owner is the v1 rate limiter. Adding on-chain caps would require a mapping + check in `approveFundRequest`. |
| Rate limits (per epoch / time window) | Same as caps. |
| Auto-approve policies | Approval stays manual. Auto-approving money flows is a footgun even on testnet. |
| Multisig owner | Deploy behind a multisig wallet if needed; no contract change required. |

---

## Deployment

```bash
# Via the CLI (recommended):
soulvault organization create --name <orgName> --ens <ensName>

# Or manually via forge create / script — the contract has no constructor args.
```

The deployer is the owner. There is no way to transfer ownership after deployment — re-deploy if ownership needs to move.
