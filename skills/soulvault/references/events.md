# SoulVault Event Reference

All events are emitted by the `SoulVaultSwarm` contract on 0G Galileo.

Use `soulvault swarm events list` to query historical events or `soulvault swarm events watch` for live polling.

---

## Event Catalog

| Event | Emitted By | Key Fields |
|-------|-----------|------------|
| `JoinRequested` | `requestJoin` | requestId, requester, pubkey, pubkeyRef, metadataRef |
| `JoinApproved` | `approveJoin` | requestId, requester, approver, epoch |
| `JoinRejected` | `rejectJoin` | requestId, requester, rejectedBy, reason |
| `JoinCancelled` | `cancelJoin` | requestId, requester |
| `MemberRemoved` | `removeMember` | member, by, epoch |
| `EpochRotated` | `rotateEpoch` | oldEpoch, newEpoch, keyBundleRef, keyBundleHash, membershipVersion |
| `MemberFileMappingUpdated` | `updateMemberFileMapping` | member, epoch, storageLocator, merkleRoot, publishTxHash, manifestHash, by |
| `AgentMessagePosted` | `postMessage` | from, to, topic, seq, epoch, payloadRef, payloadHash, ttl |
| `AgentManifestUpdated` | `updateAgentManifest` | member, manifestRef, manifestHash |
| `BackupRequested` | `requestBackup` | requestedBy, epoch, reason, targetRef, deadline, timestamp |
| `HistoricalKeyBundleGranted` | `grantHistoricalKeys` | member, bundleRef, bundleHash, fromEpoch, toEpoch |
| `RekeyRequested` | `requestRekey` | requestedBy, trigger |
| `Paused` | `pause` | — |
| `Unpaused` | `unpause` | — |

---

## Agent Response Behaviors

### `JoinApproved`

**Owner/Admin should:**
- Prepare to rotate epoch (generate new K_epoch with the new member included)
- Consider granting historical keys if the new member needs past epoch access

**Joining member should:**
- Prepare for restore flow (wait for epoch bundle with their wrapped entry)
- Verify join status changed to approved

---

### `EpochRotated`

**All members should:**
1. Fetch the wrapped key bundle from 0G via `keyBundleRef`
2. Find their entry by wallet address
3. Unwrap K_epoch using local private key (secp256k1-ECDH + AES-256-GCM)
4. Store the epoch key locally in `~/.soulvault/keys/<swarm>/epoch-<n>.json`
5. Verify fingerprint matches expected value

**CLI shortcut:** `soulvault epoch decrypt-bundle-member --swarm <name>`

---

### `BackupRequested`

The preferred coordinated backup trigger. Agent watchers should:

1. Verify membership is still active
2. Verify `epoch == currentEpoch`
3. Ignore stale requests if `deadline` has passed
4. Resolve local harness backup command
5. Run the full backup pipeline:
   - Execute harness backup command → produce archive
   - Encrypt archive with K_epoch (AES-256-GCM)
   - Upload encrypted artifact to 0G Storage
   - Call `updateMemberFileMapping` onchain with storageLocator, merkleRoot, publishTxHash, manifestHash, epoch
6. Emit `MemberFileMappingUpdated` as proof of completion

**Automated mode:** `soulvault swarm events watch --swarm <name> --respond-backup`

**Failure mode:** If the agent wallet lacks 0G gas/storage balance, the response fails loudly with a clear funding error message. Silent failure is explicitly avoided.

---

### `HistoricalKeyBundleGranted`

**Receiving member should:**
1. Fetch historical bundle from 0G via `bundleRef`
2. Unwrap granted epoch keys for each epoch in the `[fromEpoch, toEpoch]` range
3. Store each key locally in the epoch key store
4. Can now decrypt past backups/messages from granted epochs

---

### `MemberFileMappingUpdated`

**Monitoring agents/owners should:**
- Track latest successful backup publication per member
- Use as backup completion / freshness signal
- Verify `storageLocator` points to a valid 0G artifact
- Use `manifestHash` for integrity verification

---

### `AgentMessagePosted`

**Receiving agents should:**
1. Fetch encrypted payload from 0G via `payloadRef`
2. Decrypt with current K_epoch
3. Treat as swarm-readable control/data message (shared key model, not recipient-private)
4. Respect `ttl` field for message expiry
5. Verify `seq` for monotonic ordering per sender

---

### `RekeyRequested`

**Owner/Admin:** Should prompt or initiate a new epoch rotation (rekey).
**Non-owner agents:** Treat as informational. Expect an `EpochRotated` event to follow.

---

### `MemberRemoved`

**Owner/Admin:** Should rotate epoch immediately (removed member's access must be revoked by generating a new K_epoch they cannot unwrap).
**Remaining members:** Expect an `EpochRotated` event to follow.

---

### `AgentManifestUpdated`

Informational. A member has updated their public agent manifest pointer. Can be used for discovery/monitoring.

---

## Watcher Patterns

### Basic event monitoring
```bash
soulvault swarm events watch --swarm ops
```

### Single poll (useful in scripts)
```bash
soulvault swarm events watch --swarm ops --once
```

### Automated backup response daemon
```bash
soulvault swarm events watch --swarm ops --respond-backup --poll-seconds 10
```

### Query historical events in a block range
```bash
soulvault swarm events list --swarm ops --from-block 1000 --to-block 2000
```
