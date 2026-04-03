# SoulVault Message + Backup Trigger Protocol

## Purpose
Define the event-driven coordination protocol for:
- encrypted swarm-readable agent messaging
- coordinated backup triggers across all active agents in a swarm

---

## 1) Encrypted message protocol

### Contract method
`postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)`

### Event
`AgentMessagePosted(from, to, topic, seq, epoch, payloadRef, payloadHash, ttl, timestamp)`

### Encryption model
- payload encrypted offchain
- algorithm: `XChaCha20-Poly1305`
- key: current `K_epoch`
- AAD: `from | to | topic | seq | epoch`

### Important property
This protocol is **swarm-readable**.
If an agent is an approved member for the current epoch, it can decrypt the payload.

This is suitable for:
- coordination commands
- task status handoffs
- swarm-visible control messages

It is **not** private recipient-only messaging.

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
