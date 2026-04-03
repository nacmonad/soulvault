# Bootstrap + Join Flow

## First-Time Swarm Setup (Human / Owner)
1. Owner deploys swarm contract.
2. Owner configures join policy = owner approval required.
3. Owner starts `soulvault events watch --swarm <name>` to monitor for incoming join requests.
4. Owner ensures 0G Storage publication is configured.
5. Optional but recommended: configure ERC-8004 identity registry integration for per-agent public identity (Model 1).

---

## First Agent Join (Special — Root of Trust)
1. New node installs OpenClaw + SoulVault CLI.
2. Node generates a local agent keypair (keypair never leaves the node).
3. Node submits join request onchain:
   ```
   soulvault join request --swarm <name>
   ```
   This calls `requestJoin(pubkey, pubkeyRef, metadataRef)` where:
   - `pubkey` is the agent's raw asymmetric public key included directly in calldata and stored in the join request struct on the contract.
   - There is no need for a secure out-of-band channel — the pubkey is not a secret. Submitting it onchain is safe and necessary so the owner can wrap `K_epoch` without any offchain storage round-trip.
4. Owner receives `JoinRequested` event in the event watcher.
5. Owner approves via `soulvault join approve <requestId>`.
6. Contract stores `pubkey` in member record, increments `membershipVersion`, emits `JoinApproved`.
7. Owner triggers rekey to establish the shared operational epoch:
   ```
   soulvault epoch rotate
   ```
   This reads all active member pubkeys from contract state, wraps `K_epoch+1` for each + owner escrow entry, uploads bundle to encrypted storage, then calls `rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, membershipVersion)`.

---

## Subsequent Agent Joins
Same as above (owner approval path). After each approval, owner triggers `soulvault epoch rotate` to bring new member into the current epoch.

## Optional ERC-8004 Identity Registration (per-agent, Model 1)
After a member is approved, the operator MAY register that specific agent in an ERC-8004 Identity Registry.

Recommended flow:
1. Mint/register one ERC-8004 identity for the agent using a SoulVault CLI helper.
2. Build a base64-encoded `agentURI` registration payload with public-safe metadata.
3. Include service endpoints such as:
   - `web`
   - `A2A`
   - `MCP`
   - optional `SoulVault`
4. Include a custom `soulvault` object describing:
   - `swarmId`
   - `swarmContract`
   - `memberAddress`
   - `publicManifestUri`
   - `role`
   - `harness`
   - optional `backupHarnessCommand`
5. If desired, write the ERC-8004 registry coordinates into local metadata for explorers/indexers.

This identity step must remain optional in MVP and must not block restore/join.

---

## Restore Flow (Approved Member — Latest State)
1. Node reads `latestBackupPointer` + `currentEpoch` from contract.
2. Node fetches wrapped-key bundle reference from latest `EpochRotated` event.
3. Node fetches wrapped-key bundle from encrypted storage and unwraps its own `K_epoch` entry locally using its private key.
4. Node selects restore target in CLI:
   - shared swarm state
   - specific agent bundle (e.g., a particular soul/memory set)
5. Node fetches selected encrypted bundle + encrypted manifest from 0G Storage.
6. Node decrypts locally with `K_epoch` and verifies all hashes (manifest hash + per-file hashes).
7. Node writes markdown files into workspace.
8. Node starts OpenClaw runtime.

---

## Historical Key Grant Flow (New Joiner / Recovered Node)
When a newly approved member needs access to epochs before their join epoch, or a recovered node has lost its keypair and rejoined with a fresh key, the owner issues a Historical Key Grant.

**Owner side:**
1. Owner runs:
   ```
   soulvault keygrant --member <address> --from-epoch <N>
   ```
2. CLI fetches each historical wrapped-key bundle (epochs N through current-1) from encrypted storage.
3. CLI unwraps each `K_epoch` via the `ownerEscrowEntry` in each bundle (using owner's private key).
4. CLI re-wraps each `K_epoch` for the new member's pubkey (read from contract state — no offchain storage lookup needed).
5. CLI uploads Historical Key Bundle to encrypted storage.
6. CLI calls `grantHistoricalKeys(memberAddress, bundleRef, bundleHash, fromEpoch, toEpoch)`.
7. Contract emits `HistoricalKeyBundleGranted(member, bundleRef, bundleHash, fromEpoch, toEpoch)`.

**New member side:**
1. CLI detects `HistoricalKeyBundleGranted` event for own address.
2. CLI fetches Historical Key Bundle from encrypted storage.
3. CLI unwraps each epoch key locally and stores in local secure epoch-key store (indexed by epoch number).
4. Member can now decrypt any backup or message from any granted epoch.
5. Proceed with restore (latest or historical as desired).

---

## Historical Restore (Past Epoch)
1. Ensure Historical Key Bundle has been received and unwrapped (see above).
2. Look up the member file mapping for the desired epoch from historical backup mapping update events.
3. Fetch encrypted backup + manifest from 0G Storage for that epoch.
4. Decrypt with the corresponding `K_epoch` from local store.
5. Verify hashes and write files.

---

## Required Markdown Backup Set
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- selected `memory/*.md`

---

## Safety Rules
- No plaintext markdown to remote storage — always encrypt before upload.
- No private keys in backup bundle.
- Verify manifest and per-file hashes before restore.
- Bootstrap scripts must be hash-pinned/signed before execution.
- Pubkey is public — submitting it in calldata is correct and safe.
- Every wrapped-key bundle must include an `ownerEscrowEntry` (required for historical recovery to function).
