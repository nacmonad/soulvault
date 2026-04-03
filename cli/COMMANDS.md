# SoulVault CLI Command Spec

## Binary
`soulvault`

---

## 1) Swarm commands

## `soulvault swarm create`
Create a local swarm profile and optionally deploy/configure a new swarm contract.

Flags:
- `--name <name>`
- `--chain-id <id>`
- `--rpc <url>`
- `--contract <address>`
- `--owner <address>`

## `soulvault swarm list`
List known swarm profiles.

## `soulvault swarm use <name>`
Set the active swarm context.

## `soulvault swarm status [--swarm <name>]`
Show:
- contract address
- chain id
- owner
- current epoch
- membership version
- current member count
- latest mapping for current agent if any

---

## 2) Join / membership commands

## `soulvault join request`
Submit a join request for the active swarm.

Flags:
- `--swarm <name>`
- `--pubkey-ref <ref>`
- `--metadata-ref <ref>`

Behavior:
- generates/loads local agent pubkey
- calls `requestJoin(pubkey, pubkeyRef, metadataRef)`

## `soulvault join approve <requestId>`
Owner-only. Approves a pending join.

## `soulvault join reject <requestId>`
Owner-only. Rejects a pending join.

Flags:
- `--reason <text>`

## `soulvault join cancel <requestId>`
Cancel own pending join request.

## `soulvault member remove <address>`
Owner-only. Removes active member.

## `soulvault member show <address>`
Show member state and latest file mapping.

---

## 3) Epoch / recovery commands

## `soulvault epoch rotate`
Owner-only.

Flags:
- `--swarm <name>`
- `--new-epoch <n>`
- `--key-bundle-ref <ref>` (optional override)

Behavior:
- reads `membershipVersion`
- generates fresh epoch key
- wraps for active members + owner escrow
- uploads wrapped bundle
- calls `rotateEpoch(...)`

## `soulvault keygrant --member <address> --from-epoch <N>`
Owner-only historical key grant.

Flags:
- `--to-epoch <N>`
- `--swarm <name>`

Behavior:
- reconstructs historical key bundle
- uploads encrypted bundle
- calls `grantHistoricalKeys(...)`

---

## 4) Backup / restore / storage commands

## `soulvault backup request`
Emit a swarm backup trigger event.

Flags:
- `--swarm <name>`
- `--epoch <n>`
- `--reason <text>`
- `--target-ref <ref>`
- `--deadline <unix-ts>`

Behavior:
- calls `requestBackup(epoch, reason, targetRef, deadline)`
- intended for owner/coordinator use

## `soulvault backup push`
Run a backup for the current agent.

Flags:
- `--swarm <name>` (repeatable or omitted for all joined swarms)
- `--harness <name>`
- `--backup-command <cmd>`
- `--workspace <path>`
- `--manifest-only`

Behavior:
1. resolve harness + backup command from trusted local adapters
   - `openclaw` -> `soulvault-harness-openclaw backup`
   - `hermes` -> `soulvault-harness-hermes backup`
   - `ironclaw` -> `soulvault-harness-ironclaw backup`
2. execute harness-specific backup flow
3. create deterministic bundle
4. compute hashes + merkle root
5. XChaCha encrypt
6. upload to 0G
7. call `updateMemberFileMapping(...)` for each joined swarm

## `soulvault backup show`
Show latest known backup publication(s) for the current agent across swarms.

## `soulvault restore pull`
Restore encrypted state.

Flags:
- `--swarm <name>`
- `--epoch <n>`
- `--member <address>`
- `--workspace <path>`

Behavior:
- resolves wrapped key bundle
- unwraps `K_epoch`
- fetches file mapping / artifact from 0G
- decrypts + verifies hashes
- restores files locally

## `soulvault storage publish`
Low-level helper to upload an already-prepared encrypted artifact to 0G.

## `soulvault storage fetch <locator>`
Low-level helper to fetch an encrypted artifact from 0G.

---

## 5) Agent identity commands (ERC-8004)

## `soulvault agent create`
Create local agent profile/config if missing.

Flags:
- `--name <name>`
- `--harness <openclaw|hermes|custom>`
- `--backup-command <cmd>`
- `--image <uri>`

## `soulvault agent status`
Show local agent identity/config:
- wallet
- local pubkey
- harness
- backup command
- linked ERC-8004 identity if present
- joined swarms

## `soulvault identity create-agent`
Create/register an ERC-8004 identity for this agent.

Flags:
- `--registry <address>`
- `--name <name>`
- `--description <text>`
- `--image <uri>`
- `--harness <name>`
- `--backup-command <cmd>`
- `--service <name=url>` (repeatable)

Behavior:
- builds registration JSON
- embeds SoulVault custom metadata including `harness`, `backupHarnessCommand`, and `memberAddress`
- base64-encodes `agentURI`
- calls ERC-8004 identity registry `register(...)` / equivalent flow using the agent wallet signer under Model 1 / Option A

## `soulvault identity update`
Update the existing ERC-8004 registration payload.

Flags:
- `--agent-id <id>`
- `--name <name>`
- `--description <text>`
- `--image <uri>`
- `--harness <name>`
- `--backup-command <cmd>`
- `--service <name=url>` (repeatable)

## `soulvault identity show`
Show the resolved local ERC-8004 registration payload.

## `soulvault identity render-agenturi`
Render the exact base64 `agentURI` string without broadcasting.

---

## 6) Manifest / messaging / watch commands

## `soulvault manifest update`
Update the current agent's manifest ref/hash on the active swarm.

## `soulvault msg post`
Post verified message metadata.

Flags:
- `--to <address>`
- `--topic <topic>`
- `--payload-ref <ref>`
- `--payload-hash <hash>`
- `--ttl <seconds>`

## `soulvault events watch`
Watch swarm events and react locally.

Responsibilities:
- show join requests
- show epoch rotations
- react to key grants
- react to file mapping updates
- react to `BackupRequested` by running local backup flow when appropriate
- optionally trigger restore suggestions / backup reminders
