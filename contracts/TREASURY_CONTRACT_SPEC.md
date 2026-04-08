# SoulVault Treasury Contract Spec

## Purpose

`SoulVaultTreasury` is the **org-scoped payout layer** for agent fund requests. One treasury is deployed per organization on 0G Galileo. It holds native value (0G) and releases funds when the treasury owner approves a pending fund request filed on a bound swarm.

It is **not** responsible for:
- validating swarm membership (the swarm does that at request time)
- storing the fund request lifecycle (the swarm holds the authoritative state)
- ERC-20 tokens (v1 is native-only)
- spending caps or rate-limits (v1 relies on the treasury owner as the rate limiter)

The treasury is discoverable via ENS text records on the organization's root ENS name:
- `soulvault.treasuryContract` → deployed treasury address
- `soulvault.treasuryChainId` → chain id where the treasury lives (0G Galileo = `16602`)

---

## State split with SoulVaultSwarm

The fund-request flow is deliberately split across two contracts:

| Concern | Contract |
|---|---|
| Membership check (requester must be active) | `SoulVaultSwarm` |
| Request record + lifecycle (PENDING → APPROVED/REJECTED/CANCELLED) | `SoulVaultSwarm` |
| Funds custody + payout execution | `SoulVaultTreasury` |
| Treasury owner authorization | `SoulVaultTreasury` |

**Mutual consent:** the treasury only accepts approvals for swarms that have explicitly opted in by calling `swarm.setTreasury(<this treasury address>)`. Every `approveFundRequest` / `rejectFundRequest` call verifies `ISoulVaultSwarm(swarm).treasury() == address(this)` and reverts with `SwarmTreasuryMismatch` otherwise. Neither side can unilaterally bind the other.

---

## Roles

### Owner
The deployer. Immutable, set in `constructor()` from `msg.sender`. Can:
- approve / reject fund requests on bound swarms
- withdraw native value from the treasury
- (implicitly) deploy and hold the treasury

Single-signer in v1. Multisig support would require either re-deploying behind a multisig wallet or a follow-up refactor.

### Public / anyone
Can:
- deposit native value (`receive()` or `deposit()`) — deposits are open to anyone so funders don't need to be the owner

---

## Core State

### Globals
- `owner` — immutable, set at deployment to `msg.sender`
- `_locked` — internal reentrancy guard (1 = free, 2 = entered)

The treasury holds NO fund-request records of its own. It reads them from the swarm contract at approval time.

---

## Method Semantics

### `receive()` / `deposit()`

Both accept native value and emit `FundsDeposited(from, amount)`. The two entry points exist so depositors can either send value via a plain transfer (`receive()`) or call the named function explicitly.

### `approveFundRequest(address swarm, uint256 requestId)` — `onlyOwner nonReentrant`

The core of the feature. Executes in four steps:

1. **Mutual consent check:** `ISoulVaultSwarm(swarm).treasury() == address(this)` else `SwarmTreasuryMismatch`.
2. **Read request:** `ISoulVaultSwarm(swarm).getFundRequest(requestId)`. Reverts with `InvalidFundRequest` if the record is empty, `InvalidRequestState` if not PENDING, `InsufficientBalance` if `address(this).balance < req.amount`.
3. **Effect (before interaction):** `ISoulVaultSwarm(swarm).markFundRequestApproved(requestId)`. Flips the swarm-side status to APPROVED atomically. The swarm's own callback check enforces `msg.sender == treasury`.
4. **Interaction:** native value transfer to `req.requester` via `.call{value}("")`. Reverts with `TransferFailed` on recipient revert.

Emits `FundsReleased(swarm, requestId, recipient, amount)` on success.

**Reentrancy:** checks-effects-interactions ordering plus an inline `nonReentrant` modifier. Any reentry attempt via a malicious `receive()` on the requester contract will revert on the swarm-side `InvalidFundRequestState` guard because the status was already flipped in step 3. The `nonReentrant` lock is belt-and-braces.

**Paused swarm:** `markFundRequestApproved` is `whenNotPaused` on the swarm side. A paused swarm will cause the treasury call to revert atomically. Treasury-side state is unchanged. The request stays PENDING and can be re-approved after `unpause`.

### `rejectFundRequest(address swarm, uint256 requestId, string reason)` — `onlyOwner`

Calls `ISoulVaultSwarm(swarm).markFundRequestRejected(requestId, reason)` after the mutual-consent check. No funds move. Emits `FundRequestRejectedByTreasury(swarm, requestId, reason)` in addition to the swarm-side `FundRequestRejected` event.

### `withdraw(address payable to, uint256 amount)` — `onlyOwner nonReentrant`

Owner drains value from the treasury. Reverts on zero address, insufficient balance, or transfer failure. Emits `TreasuryWithdrawn(to, amount)`.

### `balance() view returns (uint256)`

Returns `address(this).balance`. Convenience view for CLI / off-chain status checks.

---

## Events

| Event | Emitted by | Fields |
|---|---|---|
| `FundsDeposited` | `receive()` / `deposit()` | `from` (indexed), `amount` |
| `FundsReleased` | `approveFundRequest` | `swarm` (indexed), `requestId` (indexed), `recipient` (indexed), `amount` |
| `FundRequestRejectedByTreasury` | `rejectFundRequest` | `swarm` (indexed), `requestId` (indexed), `reason` |
| `TreasuryWithdrawn` | `withdraw` | `to` (indexed), `amount` |

The swarm contract emits its own paired events — see `SWARM_CONTRACT_SPEC.md` §Fund Requests.

---

## Errors

| Error | When |
|---|---|
| `NotOwner` | Any owner-gated method called by non-owner |
| `SwarmTreasuryMismatch` | Swarm's `treasury()` doesn't point at this contract |
| `InvalidFundRequest` | Request id doesn't exist (requester is zero) |
| `InvalidRequestState` | Request is not PENDING at read time (cancelled / already resolved) |
| `InsufficientBalance` | Treasury balance < requested amount, or < withdraw amount |
| `TransferFailed` | Native-value `.call` returned false |
| `ZeroAddress` | Withdraw recipient is `address(0)` |
| `Reentrant` | Reentrancy guard tripped |

---

## Discovery via ENS

Per the two-lane architecture, the treasury lives on 0G Galileo but its address is discoverable via ENS text records on Sepolia (on the org's existing root ENS name — no dedicated subdomain). When `soulvault treasury create` runs, it writes two text records:

```
soulvault.treasuryContract = <0G treasury address>
soulvault.treasuryChainId  = 16602
```

A downstream consumer that knows the org's ENS name (e.g. `soulvault.eth`) can resolve the treasury address without any local state. This mirrors the swarm discovery pattern (`soulvault.swarmContract` on the swarm subdomain).

---

## What's deliberately NOT in v1

| Deferred | Reason |
|---|---|
| ERC-20 support | Native-only keeps the contract surface small. `FundRequest` struct is NOT reserved for a `token` field — a future v2 would migrate to a new struct + new mapping. |
| Per-swarm spending caps | Treasury owner is the v1 rate limiter. Adding on-chain caps would require a mapping + check in `approveFundRequest`. |
| Rate limits (per epoch / time window) | Same as caps. |
| Auto-approve policies | Approval stays manual. Auto-approving money flows is a footgun even on testnet. |
| Paused kill-switch on the treasury itself | Owner refusing to sign is the v1 kill switch. A dedicated `paused` flag is a trivial follow-up if operationally useful. |
| Multisig owner | Deploy behind a multisig wallet if needed; no contract change required. |
| Organization-level pause | See `IMPLEMENTATION_NOTES.md` — org is not a smart contract today, so cross-cutting pause is an open design question. |

---

## Deployment

```bash
# Via the CLI (recommended):
soulvault treasury create --organization <orgNameOrEns>

# Or manually via forge create / script — the contract has no constructor args.
```

The deployer is the owner. There is no way to transfer ownership after deployment — re-deploy if ownership needs to move.
