# SoulVault Message + Backup Trigger Protocol

## Purpose
Define the event-driven coordination protocol for:
- public messages
- encrypted swarm-readable agent messaging
- encrypted direct agent messaging
- coordinated backup triggers across all active agents in a swarm

---

## 1) Message protocol

### Contract method
`postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)`

### Event
`AgentMessagePosted(from, to, topic, seq, epoch, payloadRef, payloadHash, ttl, timestamp)`

### Audience / encryption inference model (MVP)
The contract does **not** carry an explicit `messageMode` field in MVP.
Instead, message audience is inferred from:
- whether the offchain payload is plaintext or encrypted
- whether `to == address(0)` or `to != address(0)`

#### Rule set
1. **Public message**
   - payload is plaintext or public-signed but not encrypted
   - `to == address(0)`

2. **Swarm-encrypted message**
   - payload is encrypted offchain
   - `to == address(0)`
   - encryption key: current `K_epoch`

3. **Direct message (DM)**
   - payload is encrypted offchain
   - `to != address(0)`
   - encryption key: recipient-specific public-key encryption / sealed-box style scheme

> `address(0)` is the MVP null/broadcast convention. Solidity does not support literal `null` addresses.

### Payload envelope recommendation
Although audience can be inferred from ciphertext/plaintext + `to`, the offchain payload SHOULD still include a lightweight envelope describing:
- `version`
- `encryption` (`none`, `aes-256-gcm`, `xchacha20-poly1305`, `sealed-box`, etc.)
- optional sender/recipient metadata
- application payload body

This keeps watcher/client logic unambiguous and leaves room for cipher upgrades later.

### Encryption model by class
#### Public
- no encryption required
- MAY be signed offchain by sender for authenticity

#### Swarm-encrypted
- payload encrypted offchain
- MVP key: current `K_epoch`
- AAD SHOULD include: `from | to | topic | seq | epoch`

#### DM
- payload encrypted offchain to the recipient's public key
- sender MAY additionally wrap to self for local sent-message readability
- AAD SHOULD include: `from | to | topic | seq | epoch`

### Important property
This protocol supports three semantics through one primitive:
- public broadcast
- swarm-readable encrypted coordination
- recipient-targeted encrypted DM

This is suitable for:
- public announcements
- coordination commands
- task status handoffs
- swarm-visible control messages
- private point-to-point instructions between agents

---

## 2) Backup trigger protocol

### Motivation
Instead of relying primarily on cron or `HEARTBEAT.md`, the swarm can coordinate backup waves through an onchain event.

This lets a coordinator/owner trigger a backup cycle for all listening agents.

### Contract method
`requestBackup(epoch, reason, targetRef, deadline)`

### Event
`BackupRequested(requestedBy, epoch, reason, targetRef, deadline, timestamp)`

### Fields
- `requestedBy`: caller emitting the trigger
- `epoch`: expected epoch for the backup run
- `reason`: human/machine readable reason (`manual`, `pre-maintenance`, `checkpoint`, `before-upgrade`)
- `targetRef`: optional scope or policy reference (for example a manifest/profile/task reference)
- `deadline`: unix timestamp by which agents should attempt backup

### Recommended restrictions
MVP recommendation:
- callable by owner
- optionally callable later by approved coordinator roles / quorum logic

### Agent-side watcher behavior
When an agent CLI sees `BackupRequested`:
1. verify local membership is still active
2. verify `epoch == currentEpoch`
3. check whether the request is stale (`deadline` in past)
4. resolve local harness backup command
5. run `backup push`
6. publish `updateMemberFileMapping(...)`

### Result model
The trigger itself does **not** guarantee all agents backed up.
Success is observed indirectly via subsequent:
- `MemberFileMappingUpdated(member, epoch, ...)`

That event trail becomes the auditable proof of who actually completed backup publication.

---

## 3) Why this is better than cron-only
- coordinated swarm checkpoints
- explicit audit trail
- useful before rekeys, maintenance, upgrades, migrations
- same event model already used by the protocol

Cron/heartbeat can still exist as fallback or background policy, but event-triggered backup becomes the preferred coordination primitive.
