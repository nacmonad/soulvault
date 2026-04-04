# Story 04 — Owner requests backup, agent watches and responds

This story demonstrates the event-driven backup loop for SoulVault.

Goal:
- have the owner/admin trigger a backup request onchain
- run an agent-side watcher in another terminal
- let the watcher detect `BackupRequested`
- run the backup flow
- upload the encrypted artifact to 0G
- publish the resulting member file mapping back to the swarm contract

This story is meant to be run with **two terminals**.

---

## Terminal 1 — Owner/admin requests backup
Use the swarm owner/admin context to request a backup for the active swarm.

Intended command shape:
```bash
soulvault backup request --swarm ops --reason "manual test checkpoint"
```

Expected behavior:
- sends `requestBackup(...)` to the live swarm contract
- emits `BackupRequested`

---

## Terminal 2 — Agent watches and responds
Run the agent-side event watcher.

Intended command shape:
```bash
soulvault events watch --swarm ops
```

or, if a backup-specific watcher surface is added:
```bash
soulvault backup watch --swarm ops
```

Expected behavior:
- polls or watches for `BackupRequested`
- detects that this swarm needs a backup response
- runs the local backup/archive/encrypt flow
- uploads the encrypted artifact to 0G
- calls `updateMemberFileMapping(...)` for the current member

---

## Verification steps
After the watcher responds, inspect the resulting onchain and storage state.

Possible commands:
```bash
soulvault backup show --swarm ops
soulvault restore verify-latest
```

The important observable outcomes are:
- a `BackupRequested` event exists
- the agent uploaded the artifact to 0G
- the swarm contract has an updated member file mapping

---

## Important failure mode — insufficient 0G gas/storage fees
The watcher/backup response path should fail **loudly** if the agent wallet does not have enough 0G funds to publish the backup artifact.

Desired error style:
```text
Backup upload failed: insufficient 0G gas/storage balance for agent wallet 0x...
Top up the agent wallet and retry the backup response.
```

This is important for demos and real operations, because silent failure would make the event-driven flow look healthy when the artifact was never actually published.

---

## Notes
- The swarm contract already supports this pattern through:
  - `requestBackup(...)`
  - `BackupRequested`
  - `updateMemberFileMapping(...)`
- The missing work is primarily CLI/runtime orchestration, not contract invention.
- Polling is acceptable for MVP; it does not need fancy subscriptions yet.
