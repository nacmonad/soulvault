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
- **fund request lifecycle** (request/approve/reject/cancel records; payout executed by the paired `SoulVaultOrganization` contract — see `ORGANIZATION_CONTRACT_SPEC.md`)

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
- bind the swarm to an organization via `setOrganization(address)` (re-settable)

### Active member
Can:
- request join (initially pending)
- post messages
- update own manifest pointer
- publish own member file mapping after a successful backup run
- **submit a fund request** via `requestFunds(amount, reason)` (organization must be bound)
- **cancel own pending fund request** via `cancelFundRequest(id)`

### Bound organization (a specific contract address, not an EOA)
Can:
- mark fund requests approved / rejected via the two `markFundRequest*` callbacks

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
- `organization` (address of the bound `SoulVaultOrganization`, zero until `setOrganization`)

### Per member
- `members[address] => Member`
- `memberFileMappings[address] => MemberFileMapping`
- `agentManifestRefs[address] => (manifestRef, manifestHash)`
- `lastSenderSeq[address] => uint64`

### Join queue
- `joinRequests[requestId] => JoinRequest`
- monotonically increasing `nextRequestId`

### Fund request queue
- `fundRequests[requestId] => FundRequest`
- monotonically increasing `nextFundRequestId` (**separate counter** from `nextRequestId` — join and fund ids live in different namespaces so they don't collide in off-chain tooling)

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
Owner emergency control. The `whenNotPaused` modifier guards `requestFunds`, `cancelFundRequest`, `markFundRequestApproved`, `markFundRequestRejected`, and all other state-mutating flows — a paused swarm blocks the entire fund-request lifecycle atomically.

**Org-level pause propagation:** when the swarm has a bound organization (`organization != address(0)`), the `whenNotPaused` modifier also checks `ISoulVaultOrganization(organization).orgPaused()`. If the org-level pause flag is set, all gated operations revert even if the swarm's own `paused` flag is false. This gives the organization owner a single-signature kill switch across all registered swarms.

**CLI gap (deferred):** `SOULVAULT_SWARM_ABI` in `cli/src/lib/swarm-contract.ts` does NOT currently include `pause()` / `unpause()` fragments, and there are no `soulvault swarm pause` / `unpause` commands. The contract and its behavior are fully covered by Foundry tests (`testRequestFundsBlockedWhenPaused`, `testPausedBlocksApproval`) and by the CLI integration test (via a workaround inline ABI). Exposing pause/unpause in the CLI is tracked as a follow-up branch — see `IMPLEMENTATION_NOTES.md`.

## `requestRekey(trigger)`
Post-MVP automation hook.

---

## Fund Requests

The fund-request lifecycle is deliberately split between this contract and `SoulVaultOrganization`. The swarm holds the **request record** and enforces **membership validation**; the organization contract holds **funds** and executes **payout**. See `ORGANIZATION_CONTRACT_SPEC.md` for the organization-side behavior.

### `setOrganization(address newOrganization)`
Owner binds the swarm to an organization contract. Re-settable.

Requirements:
- owner only
- `newOrganization != address(0)` (`ZeroAddress`)

Effects:
- stores `organization = newOrganization`
- emits `OrganizationSet(oldOrganization, newOrganization, by)`

**Re-bind note:** if there are pending fund requests at the time of re-bind, the OLD organization will no longer be able to approve them (its mutual-consent check `swarm.organization() == address(this)` will fail). The pending requests become orphaned until either the swarm re-binds back to the original organization, the NEW organization approves them, or the requester cancels and refiles. The CLI's `swarm set-organization` command prints a warning when pending requests exist.

**Deploy-time binding (NOT implemented):** The current `constructor()` takes no arguments — the organization is always bound post-deploy with a separate `setOrganization` transaction. This is deliberate because in the typical CLI flow the organization contract is deployed *after* the swarm (`organization create` → `swarm create` → `swarm set-organization`), so the organization address is not known at swarm construction time. Re-settable `setOrganization` was chosen as the recoverability mechanism for lost or misconfigured bindings. A future follow-up could add an optional `constructor(address initialOrganization)` that, if non-zero, binds immediately while leaving `setOrganization` available for rebinds — non-breaking for existing deploy scripts because the current no-arg constructor is a valid default of `initialOrganization = address(0)`. See `IMPLEMENTATION_NOTES.md` for the follow-up list.

### `requestFunds(uint256 amount, string reason) returns (uint256 requestId)`

Active member submits a fund request.

Requirements:
- caller must be an active member (`NotActiveMember`)
- `organization != address(0)` (`OrganizationNotSet`)
- `amount > 0` (`ZeroAmount`)
- not paused

Effects:
- stores request with status `PENDING`, `createdAt = block.timestamp`
- emits `FundRequested(requestId, requester, amount, reason)`
- returns the monotonic `requestId`

### `cancelFundRequest(uint256 requestId)`

Requester cancels their own pending fund request. Mirror of `cancelJoin`.

Requirements:
- request must exist and be `PENDING` (`InvalidFundRequest` / `InvalidFundRequestState`)
- caller must equal `req.requester` (`NotFundRequester`)
- not paused

Effects:
- flips status to `CANCELLED`, sets `resolvedAt`
- emits `FundRequestCancelled(requestId, requester)`

### `markFundRequestApproved(uint256 requestId)`

**Organization callback.** Called by the bound organization contract during its own `approveFundRequest` flow to flip the swarm-side status atomically before transferring value.

Requirements:
- `msg.sender == organization` (`NotOrganization`)
- request must be `PENDING`
- not paused

Effects:
- flips status to `APPROVED`, sets `resolvedAt`
- emits `FundRequestApproved(requestId, requester, organization, amount)`

**Does NOT move funds.** Payout is the organization contract's responsibility.

### `markFundRequestRejected(uint256 requestId, string reason)`

**Organization callback.** Same shape as `markFundRequestApproved` but flips to `REJECTED`.

### `getFundRequest(uint256 requestId) view returns (FundRequest)`

Reads a single fund request. The organization contract calls this during approval to read the authoritative request state.

### `nextFundRequestId() view returns (uint256)`

Exposes the current counter (for off-chain consumers).

### `organization() view returns (address)`

Exposes the current organization binding. Used by the organization contract's own mutual-consent check and by the CLI's `swarm organization-status` command.

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
