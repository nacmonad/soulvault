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
