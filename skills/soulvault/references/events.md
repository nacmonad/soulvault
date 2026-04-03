# SoulVault Event Watcher Reference

## Core events
- `JoinRequested`
- `JoinApproved`
- `MemberRemoved`
- `EpochRotated`
- `MemberFileMappingUpdated`
- `AgentMessagePosted`
- `BackupRequested`
- `AgentManifestUpdated`
- `HistoricalKeyBundleGranted`
- `RekeyRequested`

## Watcher behavior

### `JoinApproved`
- Owner: prepare to rotate epoch.
- Joining member: prepare restore flow.

### `EpochRotated`
- Fetch wrapped key bundle.
- Unwrap local `K_epoch` entry.
- Update secure epoch-key store.

### `HistoricalKeyBundleGranted`
- Fetch historical bundle.
- Unwrap granted epoch keys.
- Enable historical restore.

### `BackupRequested`
Preferred coordinated backup trigger.

Agent should:
1. verify membership is still active
2. verify `epoch == currentEpoch`
3. ignore stale request if `deadline` passed
4. resolve local harness backup command
5. run `soulvault backup push`
6. publish `MemberFileMappingUpdated` as proof of completion

### `MemberFileMappingUpdated`
- Track latest successful backup publication per member.
- Use as backup completion / freshness signal.

### `AgentMessagePosted`
- Fetch encrypted payload from `payloadRef`.
- Decrypt with current `K_epoch`.
- Treat as swarm-readable control/data message.

### `RekeyRequested`
- Owner CLI should prompt or initiate rekey.
- Non-owner agents should treat as informational.
