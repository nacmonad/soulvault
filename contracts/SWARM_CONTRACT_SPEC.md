# SoulVault Swarm Contract Spec

## Purpose
The swarm contract is the coordination root for a SoulVault swarm.

It is responsible for:
- membership admission / removal
- epoch rotation references
- historical key grant references
- per-member encrypted backup publication references
- verified messaging metadata
- coordinated backup trigger events
- agent manifest pointers
- pause / safety controls

It is **not** responsible for:
- storing plaintext
- generating keys
- decrypting anything
- implementing ERC-8004 identity logic

Agent identity is handled via **ERC-8004** separately.

---

## Roles

### Owner
Can:
- approve / reject joins
- remove members
- rotate epochs
- grant historical keys
- request swarm-wide backups
- pause / unpause

### Active member
Can:
- request join (initially pending)
- post messages
- update own manifest pointer
- publish own member file mapping after a successful backup run

### Public / automation caller
Can:
- optionally call `requestRekey(trigger)` in post-MVP automation mode

---

## Core State

### Global
- `owner`
- `paused`
- `currentEpoch`
- `membershipVersion`
- `memberCount`

### Per member
- `members[address] => Member`
- `memberFileMappings[address] => MemberFileMapping`
- `agentManifestRefs[address] => (manifestRef, manifestHash)`
- `lastSenderSeq[address] => uint64`

### Join queue
- `joinRequests[requestId] => JoinRequest`
- monotonically increasing `nextRequestId`

---

## Method Semantics

## `requestJoin(pubkey, pubkeyRef, metadataRef)`
Creates a pending join request.

Requirements:
- caller not already an active member
- `pubkey` non-empty

Effects:
- stores request
- emits `JoinRequested`

## `approveJoin(requestId)`
Owner approves a pending join.

Effects:
- activates requester as member
- copies `pubkey` into member record
- sets `joinedEpoch = currentEpoch`
- increments `membershipVersion`
- increments `memberCount`
- emits `JoinApproved`

## `rejectJoin(requestId, reason)`
Owner rejects a pending join request.

## `cancelJoin(requestId)`
Requester cancels own pending request.

## `removeMember(member)`
Owner removes an active member.

Effects:
- member becomes inactive
- increments `membershipVersion`
- decrements `memberCount`
- emits `MemberRemoved`

## `rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion)`
Owner publishes the next epoch's wrapped-key bundle reference.

Requirements:
- `expectedMembershipVersion == membershipVersion`
- `newEpoch > currentEpoch`
- non-empty `keyBundleRef`

Effects:
- updates `currentEpoch`
- emits `EpochRotated`

## `grantHistoricalKeys(member, bundleRef, bundleHash, fromEpoch, toEpoch)`
Owner publishes a historical key bundle for a member.

## `updateMemberFileMapping(member, storageLocator, merkleRoot, publishTxHash, manifestHash, epoch)`
Publishes the latest encrypted backup reference for a member.

Preferred MVP restriction:
- `msg.sender == member` OR `msg.sender == owner`
- `epoch <= currentEpoch`

Effects:
- updates member's current file mapping
- emits `MemberFileMappingUpdated`

This is the core of **Option B**.

## `postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)`
Active member posts verified message metadata.

Requirements:
- sender active
- not paused
- `seq > lastSenderSeq[sender]`
- `epoch == currentEpoch`

Effects:
- updates sender sequence
- emits `AgentMessagePosted`

Message payloads are encrypted offchain with `K_epoch`, making them swarm-readable for all approved members in that epoch.

## `requestBackup(epoch, reason, targetRef, deadline)`
Owner emits a coordinated backup trigger for listening agents.

Preferred MVP restriction:
- owner-only
- `epoch == currentEpoch`

Effects:
- emits `BackupRequested`
- does not itself perform backup publication
- downstream agents respond by running local backup flow and then calling `updateMemberFileMapping(...)`

## `updateAgentManifest(manifestRef, manifestHash)`
Active member updates own manifest pointer.

## `pause()` / `unpause()`
Owner emergency control.

## `requestRekey(trigger)`
Post-MVP automation hook.

Effects:
- emits `RekeyRequested`
- does not perform the rotation itself

---

## Storage Strategy Notes

The contract stores only:
- storage references / locators
- hashes / merkle roots
- membership / epoch metadata

The contract never stores:
- plaintext agent memory
- symmetric epoch keys
- decrypted manifests

---

## ERC-8004 Relationship

The swarm contract should optionally store or index nothing about ERC-8004 in MVP.

The CLI can maintain linkage offchain or later add optional helper mappings such as:
- `member => agentRegistry`
- `member => agentId`

But those are not required for the first implementation.
