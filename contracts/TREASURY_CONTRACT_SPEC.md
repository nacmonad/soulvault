# SoulVault Treasury Contract Spec

## Purpose

`SoulVaultTreasury` is the **org-scoped payout layer** for agent fund requests. One treasury is deployed per organization on 0G Galileo. It holds native value (0G) and releases funds when the treasury owner approves a pending fund request filed on a bound swarm.

It is **not** responsible for:
- validating swarm membership (the swarm does that at request time)
- storing the fund request lifecycle (the swarm holds the authoritative state)
- ERC-20 tokens (v1 is native-only)
- spending caps or rate-limits (v1 relies on the treasury owner as the rate limiter)

The treasury is discoverable via an **ENSIP-11 multichain `addr` record** on the organization's root ENS name, keyed by the EVM coinType for the target chain (`0x80000000 | chainId`). An org that operates on multiple chains deploys one treasury per chain and publishes each under its own coinType slot — `addr(orgNode, coinType)` returns the treasury address for that chain, and setting one coinType does not clobber the others. For 0G Galileo, `coinType = 0x80000000 | 16602 = 2147500186`.

Example read via `cast`:
```
cast call <publicResolver> 'addr(bytes32,uint256)(bytes)' $(cast namehash myorg.eth) 2147500186
```

The legacy single-valued `soulvault.treasuryContract` / `soulvault.treasuryChainId` text records used in earlier prototypes have been removed in favor of ENSIP-11, which supports multi-chain discovery natively.

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

### `chainId() view returns (uint256)`

Returns the EVM chain ID that this treasury was deployed on, captured as `block.chainid` in the constructor and stored as an immutable. Because fund request approval and release happen atomically in a single transaction, the treasury must live on the same chain as the swarms that reference it. Clients (notably the CLI's `swarm set-treasury` command) probe this view before binding a swarm to a treasury and reject mismatched chains with a clear error instead of allowing a silent mis-configuration. An org that operates on multiple chains deploys one treasury per chain and discovers them through the org's ENS name using multi-chain address resolution (ENSIP-11).

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

Per the two-lane architecture, the treasury lives on 0G Galileo (chain `16602`) but its address is discoverable via an ENSIP-11 multichain `addr` record on Sepolia (on the org's existing root ENS name — no dedicated subdomain). When `soulvault treasury create` runs, it calls `resolver.setAddr(orgNode, coinType, treasuryAddress)` where `coinType = 0x80000000 | chainId`:

```
addr(namehash('myorg.eth'), 2147500186) = <0G treasury address>   # coinType = 0x80000000 | 16602
```

A downstream consumer that knows the org's ENS name can resolve the treasury for any chain by calling `addr(node, coinType)` with the appropriate coinType. An org with treasuries on multiple chains gets one slot per chain for free; setting one doesn't clobber the others.

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
