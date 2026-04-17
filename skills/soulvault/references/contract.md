# SoulVault Swarm Contract Reference

The `SoulVaultSwarm` contract is deployed on 0G Galileo. It is the single source of truth for swarm membership, epoch state, backup coordination, and file mapping.

**Interface:** `ISoulVaultSwarm.sol`
**Implementation:** `SoulVaultSwarm.sol`
**Solidity:** 0.8.24, Cancun EVM

---

## Structs

### `Member`
```solidity
struct Member {
    bool active;
    bytes pubkey;      // secp256k1 public key (submitted at join time)
    uint256 joinedEpoch;
}
```

### `JoinRequest`
```solidity
struct JoinRequest {
    address requester;
    bytes pubkey;
    string pubkeyRef;
    string metadataRef;
    uint8 status;      // 0=pending, 1=approved, 2=rejected, 3=cancelled
}
```

### `MemberFileMapping`
```solidity
struct MemberFileMapping {
    string storageLocator;   // 0G root hash
    bytes32 merkleRoot;      // SHA256 of ciphertext
    bytes32 publishTxHash;   // 0G upload tx hash
    bytes32 manifestHash;    // SHA256 of manifest JSON
    uint256 epoch;
    uint256 updatedAt;
}
```

---

## State Variables

| Variable | Type | Description |
|----------|------|-------------|
| `owner` | `address` | Contract owner (can approve, rotate, remove, pause) |
| `currentEpoch` | `uint256` | Current epoch number |
| `membershipVersion` | `uint256` | Incremented on every join approval or member removal |
| `memberCount` | `uint256` | Count of active members |

---

## Membership Functions

### `requestJoin(bytes pubkey, string pubkeyRef, string metadataRef) → uint256 requestId`
Submit a join request with the agent's secp256k1 public key.

### `approveJoin(uint256 requestId)`
Owner-only. Activates the member, stores pubkey, increments `membershipVersion`.

### `rejectJoin(uint256 requestId, string reason)`
Owner-only. Rejects a pending request.

### `cancelJoin(uint256 requestId)`
Requester-only. Cancels their own pending request.

### `removeMember(address member)`
Owner-only. Deactivates a member, increments `membershipVersion`. **Should be followed by epoch rotation.**

---

## Epoch Functions

### `rotateEpoch(uint256 newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint256 expectedMembershipVersion)`
Owner-only. Requires:
- `newEpoch > currentEpoch`
- `expectedMembershipVersion == membershipVersion` (concurrency guard)

Emits `EpochRotated(oldEpoch, newEpoch, keyBundleRef, keyBundleHash, membershipVersion)`.

### `grantHistoricalKeys(address member, string bundleRef, bytes32 bundleHash, uint256 fromEpoch, uint256 toEpoch)`
Owner-only. Grants historical epoch keys to a member (new joiner or recovery). Emits `HistoricalKeyBundleGranted`.

---

## Backup & Storage Functions

### `requestBackup(uint256 epoch, string reason, string targetRef, uint256 deadline)`
Emits `BackupRequested`. Used by owner to trigger coordinated backup waves.

### `updateMemberFileMapping(address member, string storageLocator, bytes32 merkleRoot, bytes32 publishTxHash, bytes32 manifestHash, uint256 epoch)`
- Members can publish their own mapping (`msg.sender == member`)
- Owner can publish for any member
- Non-owner cannot publish for another member

Emits `MemberFileMappingUpdated`.

---

## Messaging Functions

### `postMessage(address to, bytes32 topic, uint256 seq, uint256 epoch, string payloadRef, bytes32 payloadHash, uint256 ttl)`
Members only. Requires monotonically increasing `seq` per sender. Emits `AgentMessagePosted`.

---

## Manifest & Controls

### `updateAgentManifest(string manifestRef, bytes32 manifestHash)`
Members update their public agent manifest pointer. Emits `AgentManifestUpdated`.

### `pause()` / `unpause()`
Owner-only. Emits `Paused` / `Unpaused`.

### `requestRekey(string trigger)`
Emits `RekeyRequested`. Signals that the swarm should rotate epoch keys.

---

## View Functions

| Function | Returns |
|----------|---------|
| `getMember(address)` | `(active, pubkey, joinedEpoch)` |
| `getJoinRequest(uint256 requestId)` | `(requester, pubkey, pubkeyRef, metadataRef, status)` |
| `getMemberFileMapping(address)` | `(storageLocator, merkleRoot, publishTxHash, manifestHash, epoch, updatedAt)` |
| `getAgentManifest(address)` | `(manifestRef, manifestHash)` |
| `owner()` | `address` |
| `currentEpoch()` | `uint256` |
| `membershipVersion()` | `uint256` |
| `memberCount()` | `uint256` |
| `treasury()` | `address` — bound treasury (zero if unbound) |

---

## Treasury Binding

### `constructor(address initialTreasury)`
Deploy a SoulVaultSwarm. If `initialTreasury` is non-zero, the swarm is born already bound to that treasury and emits `TreasurySet(address(0), initialTreasury, msg.sender)`. Passing `address(0)` deploys a stealth swarm with deferred treasury binding (via `setTreasury`).

### `setTreasury(address newTreasury)`
Owner-only. Binds (or rebinds) the swarm to a treasury contract. Re-settable. Emits `TreasurySet(oldTreasury, newTreasury, msg.sender)`.

---

## Fund Request Functions

### `requestFunds(uint256 amount, string reason) → uint256 requestId`
Active members only. Files a fund request against the bound treasury. Requires treasury to be set and amount > 0. Emits `FundRequested`.

### `cancelFundRequest(uint256 requestId)`
Requester-only. Cancels a pending request. Emits `FundRequestCancelled`.

### `markFundRequestApproved(uint256 requestId)`
Called by the bound treasury contract during `approveFundRequest`. Not callable by external accounts. Emits `FundRequestApproved`.

### `markFundRequestRejected(uint256 requestId, string reason)`
Called by the bound treasury contract during `rejectFundRequest`. Not callable by external accounts. Emits `FundRequestRejected`.

---

## Fund Request Views

| Function | Returns |
|----------|---------|
| `getFundRequest(uint256 requestId)` | `(requester, amount, reason, status, resolvedAt)` |
| `fundRequestCount()` | `uint256` — total requests filed |

---

# SoulVaultTreasury Contract Reference

The `SoulVaultTreasury` contract is deployed on 0G Galileo — one per organization per chain. It holds native value and releases funds on approved fund requests. Discoverable via ENSIP-11 multichain `addr` record on the org's ENS name, keyed by `coinType = 0x80000000 | chainId`.

**Interface:** `ISoulVaultTreasury.sol`
**Implementation:** `SoulVaultTreasury.sol`
**Solidity:** 0.8.24, Cancun EVM

---

## State Variables

| Variable | Type | Description |
|----------|------|-------------|
| `owner` | `address` (immutable) | Contract owner (can approve/reject fund requests, withdraw) |
| `chainId` | `uint256` (immutable) | EVM chain ID captured at construction (`block.chainid`) |

---

## Functions

### `deposit() payable`
Anyone can deposit native value into the treasury. Emits `FundsDeposited`.

### `approveFundRequest(address swarm, uint256 requestId)`
Owner-only. Verifies mutual consent (`ISoulVaultSwarm(swarm).treasury() == address(this)`), reads the pending request from the swarm, marks it approved on the swarm side, and transfers the requested amount to the original requester. Emits `FundsReleased`. Reverts with `InsufficientBalance` if the treasury doesn't have enough.

### `rejectFundRequest(address swarm, uint256 requestId, string reason)`
Owner-only. Verifies mutual consent, marks the request rejected on the swarm side. Emits `FundRequestRejectedByTreasury`. No funds move.

### `withdraw(address to, uint256 amount)`
Owner-only. Drains native value from the treasury. Emits `TreasuryWithdrawn`.

### `balance() view → uint256`
Returns `address(this).balance`.

### `chainId() view → uint256`
Returns the EVM chain ID captured at construction. Used by clients to detect cross-chain mis-wiring before binding a swarm to a treasury.
