# SoulVault Event Reference

Events are emitted by **two contracts** on 0G Galileo:
- `SoulVaultSwarm` — per-swarm lifecycle events (membership, epochs, messaging, backups, fund requests)
- `SoulVaultTreasury` — org-scoped treasury events (deposits, payouts, rejections, withdrawals)

Use `soulvault swarm events list` or `soulvault swarm events watch` to query / poll. When a swarm is bound to a treasury (via `setTreasury`), the CLI automatically merges events from both contracts into a single stream, sorted by `(blockNumber, logIndex)` so that same-tx event pairs (notably `FundRequestApproved` on the swarm → `FundsReleased` on the treasury) render in their on-chain order. Each entry carries a `source: 'swarm' | 'treasury'` discriminator.

---

## Swarm Event Catalog

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
| `TreasurySet` | `setTreasury` | oldTreasury, newTreasury, by |
| `FundRequested` | `requestFunds` | requestId, requester, amount, reason |
| `FundRequestApproved` | `markFundRequestApproved` (called by treasury) | requestId, requester, treasury, amount |
| `FundRequestRejected` | `markFundRequestRejected` (called by treasury) | requestId, requester, treasury, reason |
| `FundRequestCancelled` | `cancelFundRequest` | requestId, requester |
| `Paused` | `pause` | — |
| `Unpaused` | `unpause` | — |

## Treasury Event Catalog

| Event | Emitted By | Key Fields |
|-------|-----------|------------|
| `FundsDeposited` | `receive()` / `deposit()` | from, amount |
| `FundsReleased` | `approveFundRequest` | swarm, requestId, recipient, amount |
| `FundRequestRejectedByTreasury` | `rejectFundRequest` | swarm, requestId, reason |
| `TreasuryWithdrawn` | `withdraw` | to, amount |

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

### `TreasurySet`

**Treasury owner should:**
- Confirm the swarm they expect has bound to their treasury address
- Sanity-check the `by` field matches the expected swarm owner

**Swarm members should:**
- Update any local cache of the swarm's `treasuryAddress` (the CLI does this automatically in `swarm set-treasury`)
- Note: a rebind while fund requests are pending orphans those requests from the old treasury

---

### `FundRequested`

**Treasury owner should:**
1. Evaluate the request — check the `requester` is a legitimate member (confirmed by the swarm-side membership gate at filing time)
2. Check treasury balance is sufficient via `soulvault treasury status`
3. Decide on approval based on reason, current budget, and any off-chain policy
4. Call `soulvault treasury approve-fund --swarm <slug> --request-id <id>` to release funds, OR `soulvault treasury reject-fund --swarm <slug> --request-id <id> --reason <text>` to refuse

**Requesting agent should:**
- Monitor for `FundRequestApproved` (payout imminent) or `FundRequestRejected` (no funds)
- If urgency changes, can cancel own request via `soulvault swarm cancel-fund-request --request-id <id>`

**Automated mode:** none. Auto-approving money flows is intentionally NOT supported — approval stays manual per the v1 scope.

---

### `FundRequestApproved`

Fires when the treasury has marked the swarm-side request APPROVED. Paired with `FundsReleased` (treasury event) in the same transaction — when the CLI event watcher merges swarm + treasury events, the two appear consecutively.

**Requesting agent should:**
- Expect the native-value transfer to settle in the same block
- Record receipt in local accounting / last-known-funding metadata (not currently auto-tracked by the CLI)

---

### `FundRequestRejected`

**Requesting agent should:**
- Read the `reason` field for context
- Decide whether to refile (different amount / reason) or drop the request

---

### `FundRequestCancelled`

Informational. The requester withdrew their own pending request. Treasury owner can ignore this request id.

---

### `FundsDeposited` (treasury)

**Treasury owner should:**
- Verify the deposit source (`from` field) matches an expected funder
- Update treasury balance tracking

**Off-chain funders:** no action needed beyond the deposit itself.

---

### `FundsReleased` (treasury)

Paired with `FundRequestApproved` in the same tx. The authoritative record of the actual value transfer (the swarm-side event only records the status flip — the transfer happens on the treasury).

**Monitoring agents should:**
- Track `recipient`, `amount`, and `requestId` for audit trails
- Correlate with the same-tx `FundRequestApproved` on the swarm contract

---

### `FundRequestRejectedByTreasury`

Treasury-side mirror of the swarm's `FundRequestRejected`. Emitted for off-chain consumers that only watch the treasury contract. The two events are redundant but each is useful depending on which contract the consumer is watching.

---

### `TreasuryWithdrawn`

Treasury owner drained value from the treasury. Informational for off-chain monitoring. Agents expecting fund requests to be approvable soon should check treasury balance.

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
