# Story 04 — Owner requests backup, agent watches and responds

This story demonstrates the event-driven backup coordination loop.

Goal:
- have the owner/admin trigger a backup request onchain
- run an agent-side watcher in another terminal
- let the watcher detect `BackupRequested`
- run the backup flow (archive → encrypt → upload → file mapping)
- verify the result onchain and in 0G

This story is meant to be run with **two terminals**.

Prerequisite: **Story 00** (org, swarm, membership) and **Story 03** (at least one epoch rotated, so a K_epoch exists for encryption).

---

## Terminal 2 (start first) — Agent watches and auto-responds
Start the event watcher with `--respond-backup` so it automatically executes the full backup flow when it sees `BackupRequested`.

```bash
soulvault swarm events watch --swarm ops --respond-backup
```

Leave this running. It polls the swarm contract for new events every 5 seconds.

When it detects `BackupRequested`, it will:
1. Run the configured harness backup command (archives the workspace)
2. Encrypt the archive with the current epoch key (AES-256-GCM)
3. Upload the encrypted artifact to 0G Storage
4. Call `updateMemberFileMapping(...)` on the swarm contract to publish proof

---

## Terminal 1 — Owner/admin triggers the backup request
```bash
soulvault swarm backup-request --swarm ops --reason "manual test checkpoint"
```

Behavior:
- calls `requestBackup(epoch, reason, targetRef, deadline)` on the swarm contract
- emits `BackupRequested` on-chain
- the watcher in Terminal 2 picks it up on the next poll cycle

On a **Ledger**, expect a signing prompt for the 0G Galileo transaction.

---

## Verification

### Check events
```bash
soulvault swarm events list --swarm ops
```

You should see both:
- a `BackupRequested` event (from the owner trigger)
- a `MemberFileMappingUpdated` event (from the agent's response)

### Verify the backup end-to-end
```bash
soulvault restore verify-latest
```

This downloads the encrypted artifact from 0G, decrypts it with the local epoch key, extracts the archive, and compares SHA256 hashes of key files against the source workspace.

### Manual backup (without the watcher)
If you prefer to run the backup flow manually instead of using `--respond-backup`:

```bash
soulvault backup push --workspace /path/to/workspace
```

This archives, encrypts, uploads to 0G, and records the manifest in `~/.soulvault/last-backup.json`. It does **not** call `updateMemberFileMapping` — that's handled separately by the watcher or would need to be done manually.

---

## Important failure mode — insufficient 0G gas/storage fees
The backup response path fails **loudly** if the agent wallet does not have enough 0G funds to upload the artifact.

```text
Backup upload failed: insufficient 0G gas/storage balance for agent wallet 0x...
Top up the agent wallet and retry the backup response.
```

Silent failure would make the event-driven flow look healthy when no artifact was actually published.

---

## Notes
- The swarm contract drives this pattern: `requestBackup(...)` → `BackupRequested` → agent responds → `updateMemberFileMapping(...)`
- `swarm backup-request` is the **owner/coordinator** trigger (emits the event). `backup push` is the **agent-side** response (archives + encrypts + uploads).
- Polling via `swarm events watch` is the MVP approach. It does not require WebSocket subscriptions.
- The `--respond-backup` flag wires the full response pipeline: detect → backup → encrypt → upload → publish mapping.
