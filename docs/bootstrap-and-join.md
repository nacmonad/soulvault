# Bootstrap + Join Flow

## First-Time Swarm Setup (Human / Owner)
1. Owner deploys swarm contract.
2. Owner configures join policy = owner approval required.
3. Owner starts `soulvault events watch --swarm <name>` to monitor for incoming join requests.
4. Owner ensures IPFS pinning provider is configured (`soulvault config set ipfs-provider <pinata|web3storage|local>`).

---

## First Agent Join (Special — Root of Trust)
1. New node installs OpenClaw + SoulVault CLI.
2. Node generates a local agent keypair (keypair never leaves the node).
3. Node submits join request onchain:
   ```
   soulvault join request --swarm <name>
   ```
   This calls `requestJoin(pubkey, pubkeyRef, metadataCid)` where:
   - `pubkey` is the agent's raw asymmetric public key included directly in calldata and stored in the join request struct on the contract.
   - There is no need for a secure out-of-band channel — the pubkey is not a secret. Submitting it onchain is safe and necessary so the owner can wrap `K_epoch` without any IPFS round-trip.
4. Owner receives `JoinRequested` event in the event watcher.
5. Owner approves via `soulvault join approve <requestId>`.
6. Contract stores `pubkey` in member record, increments `membershipVersion`, emits `JoinApproved`.
7. Owner triggers rekey to establish the shared operational epoch:
   ```
   soulvault epoch rotate
   ```
   This reads all active member pubkeys from contract state, wraps `K_epoch+1` for each + owner escrow entry, uploads bundle to IPFS, then calls `rotateEpoch(newEpoch, keyBundleCid, keyBundleHash, membershipVersion)`.

---

## Subsequent Agent Joins
Same as above (owner approval path). After each approval, owner triggers `soulvault epoch rotate` to bring new member into the current epoch.

---

## Restore Flow (Approved Member — Latest State)
1. Node reads `latestBackupPointer` + `currentEpoch` from contract.
2. Node fetches wrapped-key bundle CID from latest `EpochRotated` event.
3. Node fetches wrapped-key bundle from IPFS and unwraps its own `K_epoch` entry locally using its private key.
4. Node selects restore target in CLI:
   - shared swarm state
   - specific agent bundle (e.g., a particular soul/memory set)
5. Node fetches selected **encrypted bundle** from IPFS (`bundleCid`).
6. Node decrypts locally with `K_epoch`, unpacks the archive, reads embedded **`manifest.json`**, checks **`manifestHash`** against the chain, then verifies per-file hashes.
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
2. CLI fetches each historical wrapped-key bundle (epochs N through current-1) from IPFS.
3. CLI unwraps each `K_epoch` via the `ownerEscrowEntry` in each bundle (using owner's private key).
4. CLI re-wraps each `K_epoch` for the new member's pubkey (read from contract state — no IPFS needed).
5. CLI uploads Historical Key Bundle to IPFS.
6. CLI calls `grantHistoricalKeys(memberAddress, bundleCid, bundleHash, fromEpoch, toEpoch)`.
7. Contract emits `HistoricalKeyBundleGranted(member, bundleCid, bundleHash, fromEpoch, toEpoch)`.

**New member side:**
1. CLI detects `HistoricalKeyBundleGranted` event for own address.
2. CLI fetches Historical Key Bundle from IPFS.
3. CLI unwraps each epoch key locally and stores in local secure epoch-key store (indexed by epoch number).
4. Member can now decrypt any backup or message from any granted epoch.
5. Proceed with restore (latest or historical as desired).

---

## Historical Restore (Past Epoch)
1. Ensure Historical Key Bundle has been received and unwrapped (see above).
2. Look up backup pointer for the desired epoch from historical `BackupPointerUpdated` events.
3. Fetch **encrypted backup bundle** (`bundleCid`) from IPFS for that epoch (manifest inside archive).
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
- No plaintext markdown to IPFS — always encrypt before upload.
- No private keys in backup bundle.
- Verify manifest and per-file hashes before restore.
- Bootstrap scripts must be hash-pinned/signed before execution.
- Pubkey is public — submitting it in calldata is correct and safe.
- Every wrapped-key bundle must include an `ownerEscrowEntry` (required for historical recovery to function).
