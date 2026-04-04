# SoulVault Workflow Examples

Executable end-to-end workflows. These correspond to the stories in `/stories/`.

---

## Workflow 1: Bootstrap Organization + Swarm (Story 00)

Create the foundational infrastructure for a swarm.

```bash
# 1. Create organization profile
soulvault organization create --name soulvault --ens-name soulvault.eth --public

# 2. Register ENS root on Sepolia (two-step commit+register)
soulvault organization register-ens --organization soulvault.eth

# 3. Deploy swarm contract on 0G Galileo + bind ENS subdomain
soulvault swarm create --organization soulvault.eth --name ops

# 4. Set active swarm context
soulvault swarm use ops

# 5. Agent submits join request (includes secp256k1 pubkey in calldata)
soulvault swarm join-request --swarm ops

# 6. Check join status
soulvault swarm join-status --swarm ops --request-id 1

# 7. Owner approves join request
soulvault swarm approve-join --swarm ops --request-id 1

# 8. Verify approval
soulvault swarm join-status --swarm ops --request-id 1
```

**Note:** In dev/test flows, the same wallet may act as organization owner, swarm owner, and agent. In production, privileged actions should use a separate admin signer (ideally Ledger-backed).

---

## Workflow 2: Browse & Inspect (Story 01)

Operator/demo flow for visibility into the swarm hierarchy.

```bash
# List known organizations
soulvault organization list

# Inspect organization metadata and ENS state
soulvault organization status --organization soulvault.eth

# List known swarms
soulvault swarm list

# Select active swarm
soulvault swarm use ops

# Inspect member public identities (bridges swarm membership → ERC-8004)
soulvault swarm member-identities --swarm ops
```

`member-identities` output includes per member: wallet, active status, joinedEpoch, pubkey, whether they match the local agent, and any ERC-8004 identities found on Sepolia.

---

## Workflow 3: Epoch Bundle Rotation + Verification (Story 03)

Proves the core K_epoch publication loop.

```bash
# 1. Rotate to a new epoch (generate key, wrap per member, upload, call contract)
soulvault epoch rotate --swarm ops

# 2. Fetch and inspect the latest bundle from 0G
soulvault epoch show-bundle --swarm ops

# 3. Verify current member can decrypt their own entry
soulvault epoch decrypt-bundle-member --swarm ops

# (Dev/debug only) Print the raw unwrapped epoch key
soulvault epoch decrypt-bundle-member --swarm ops --print-key
```

**Important:** `rotateEpoch` includes a `membershipVersion` concurrency guard. If membership changed between bundle generation and the onchain call, the transaction reverts. Re-run the rotation to pick up the current roster.

---

## Workflow 4: Event-Driven Backup (Story 04)

Two-terminal flow demonstrating coordinated backup.

### Terminal 1 — Owner triggers backup
```bash
soulvault swarm backup-request --swarm ops --reason "manual test checkpoint"
```

This calls `requestBackup(...)` on the swarm contract, emitting a `BackupRequested` event.

### Terminal 2 — Agent watches and responds
```bash
# Manual monitoring
soulvault swarm events watch --swarm ops

# OR: Automated response mode (detects + runs full backup pipeline)
soulvault swarm events watch --swarm ops --respond-backup
```

The `--respond-backup` flag triggers:
1. Detect `BackupRequested` event
2. Run harness backup command → produce archive
3. Encrypt with K_epoch (AES-256-GCM)
4. Upload to 0G Storage
5. Publish `updateMemberFileMapping` onchain (storageLocator, merkleRoot, publishTxHash, manifestHash, epoch)

### Verification
```bash
# Verify the backup round-trips correctly
soulvault restore verify-latest

# Or skip re-downloading from 0G (use local encrypted artifact)
soulvault restore verify-latest --skip-download
```

---

## Workflow 5: Manual Backup + Restore

Agent-initiated backup without the event-driven coordination layer.

### Backup
```bash
# Full backup: archive → encrypt → upload to 0G
soulvault backup push

# Backup a specific workspace
soulvault backup push --workspace /path/to/project

# Local-only (encrypt but don't upload)
soulvault backup push --skip-upload
```

### Restore
```bash
# Decrypt a specific encrypted backup
soulvault restore pull \
  --encrypted /path/to/backup.enc \
  --nonce <hex> \
  --aad "<text>" \
  --auth-tag <hex> \
  --output /path/to/restored.tar.gz
```

The nonce, aad, and auth-tag values come from the backup manifest (`~/.soulvault/last-backup.json`).

---

## Workflow 6: Agent Identity Registration (ERC-8004)

Register a public identity for the agent on Sepolia.

```bash
# 1. Create local agent profile
soulvault agent create --name RustyBot --harness openclaw

# 2. Preview the agent URI (without registering)
soulvault agent render-agenturi --swarm ops --name RustyBot --description "Swarm coordination agent"

# 3. Register onchain on Sepolia
soulvault agent register \
  --swarm ops \
  --name RustyBot \
  --description "Swarm coordination agent" \
  --service api=https://api.example.com \
  --service a2a=https://a2a.example.com

# 4. Update an existing registration
soulvault agent update --agent-id 1 --description "Updated description"

# 5. Query identity (by agent ID or wallet)
soulvault agent show
soulvault agent show --agent-id 1
```

---

## Workflow 7: Swarm Messaging (Public, Group, DM)

Post messages using the three-mode protocol defined in MESSAGE_PROTOCOL.md.

### Public broadcast (plaintext, anyone can read)
```bash
soulvault msg post --topic status --body "agent checkpoint: all systems nominal" --mode public
```

### Group-encrypted message (swarm-readable via K_epoch)
```bash
# Requires local epoch key — run this first if on a new machine:
soulvault epoch decrypt-bundle-member --swarm ops

# Post encrypted coordination message
soulvault msg post --topic coordination --body '{"task":"reindex","priority":1}' --mode group --swarm ops
```

### Direct message (encrypted to recipient's pubkey)
```bash
soulvault msg post --topic handoff --body "private task details" --mode dm --to 0xRecipientAddress --swarm ops
```

### List all messages
```bash
soulvault msg list --swarm ops
```

### Fetch and decrypt a message
```bash
# Public message (no decryption needed)
soulvault msg show --payload-ref 0xRootHash

# Encrypted message (auto-detects group vs dm)
soulvault msg show --payload-ref 0xRootHash --swarm ops --decrypt
```

**Message flow:** body → JSON envelope → upload to 0G → call `postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)` onchain → `AgentMessagePosted` event emitted.

Sequence numbers are auto-incremented. Epoch is auto-resolved from contract state.

---

## Workflow 8: New Member Onboarding (Full Cycle)

Complete flow from join request to first backup. Includes the `epoch decrypt-bundle-member` auto-import fix for new machines.

```bash
# --- New member terminal ---

# 1. Create agent profile
soulvault agent create --name NewBot --harness openclaw

# 2. Submit join request
soulvault swarm join-request --swarm ops

# --- Owner terminal ---

# 3. Approve the join
soulvault swarm approve-join --swarm ops --request-id <id>

# 4. Rotate epoch (includes new member in key bundle)
soulvault epoch rotate --swarm ops

# --- New member terminal ---

# 5. Decrypt epoch key from bundle
soulvault epoch decrypt-bundle-member --swarm ops

# 6. Start watching for backup requests
soulvault swarm events watch --swarm ops --respond-backup

# --- Owner terminal ---

# 7. Trigger a backup wave
soulvault swarm backup-request --swarm ops --reason "onboarding checkpoint"
```
