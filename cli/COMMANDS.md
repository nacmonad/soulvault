# SoulVault CLI Command Spec

## Binary
`soulvault`

---

## 1) Entity-first command model

Top-level CLI nouns should map to real SoulVault entities:
- `soulvault organization ...`
- `soulvault swarm ...`
- `soulvault agent ...`

Auxiliary surfaces like `identity`, `backup`, `restore`, and `storage` may remain as helpers during scaffold phases, but the long-term UX should hang primary lifecycle actions off the owning entity.

State model assumptions:
- `.env` provides default signer/RPC/bootstrap values
- canonical local entities live under `~/.soulvault/`
- SoulVault should support 0..N organizations and 0..N swarms locally
- `organization use` / `swarm use` select active context

## 2) Organization + swarm commands

## `soulvault organization create`
Create a local organization profile and optionally bind or register an ENS root name.

Flags:
- `--name <name>`
- `--ens-name <name>`
- `--public`
- `--private`
- `--eth-rpc <url>`
- `--ens-rpc <url>`

Notes:
- Organization is the root public namespace layer.
- Example: `soulvault.eth`
- ENS binding/registration is optional in early scaffold phases but the organization entity should exist locally either way.

## `soulvault organization list`
List known organization profiles.

## `soulvault organization use <name|ens-name>`
Set the active organization context.

## `soulvault organization status [--organization <name|ens-name>]`
Show:
- local organization profile
- ENS root name if configured
- visibility posture
- linked swarms
- owner wallet / treasury settings if configured

## `soulvault organization fund-agent`
Send ETH/native gas funds from the organization owner wallet to an agent wallet.

Flags:
- `--organization <name|ens-name>`
- `--to <address>`
- `--amount <value>`
- `--asset <native>` (MVP default: native gas token only)
- `--chain <0g|eth|ens>`
- `--reason <text>`

Behavior:
- resolves the organization owner signer
- chooses the correct RPC lane based on target chain
- sends native gas funds to the target agent wallet
- records a local funding history entry for operator visibility

## `soulvault organization fund-swarm`
Fund one or more known agent wallets associated with a swarm.

Flags:
- `--organization <name|ens-name>`
- `--swarm <name>`
- `--amount <value>`
- `--chain <0g|eth|ens>`
- `--only <address>` (repeatable, optional filter)
- `--dry-run`

Behavior:
- resolves known member/agent wallets for the swarm
- previews or executes a batch of native gas transfers
- useful for topping up agents before joins, ENS writes, backups, or registry actions

## `soulvault organization register-ens`
Register or bind the organization's ENS root name.

## `soulvault organization update-metadata`
Update public-safe organization ENS metadata / records.

## `soulvault swarm create`
Create a local swarm profile and optionally deploy/configure a new swarm contract.

Flags:
- `--organization <name|ens-name>`
- `--name <name>`
- `--chain-id <id>`
- `--rpc <url>`
- `--contract <address>`
- `--owner <address>`
- `--ens-name <name>` (optional explicit swarm ENS name; otherwise derived from organization + swarm name when appropriate)
- `--public` (mark swarm as intended for public discovery)
- `--private` (default posture when ENS is omitted)

Notes:
- ENS is optional and is used for naming/discovery only.
- For SoulVault-on-0G, ENS is expected to be managed through Ethereum-facing ENS infrastructure (Sepolia by default for dev/test).
- SoulVault contract state remains the source of truth for membership and coordination.
- The CLI should therefore keep separate RPC config for swarm operations vs ENS operations.
- The CLI env/config should also carry explicit Sepolia ENS contract defaults so lookup/write support is straightforward.
- Example: `soulvault swarm create --organization soulvault.eth --name ops` -> `ops.soulvault.eth`

## `soulvault swarm list`
List known swarm profiles.

## `soulvault swarm use <name>`
Set the active swarm context.

## `soulvault swarm status [--swarm <name>]`
Show:
- contract address
- chain id
- owner
- parent organization
- current epoch
- membership version
- current member count
- latest mapping for current agent if any

## `soulvault swarm member-file-mapping`
Inspect the current onchain backup/file mapping for a swarm member.

Flags:
- `--swarm <name|ens-name>`
- `--member <address>`

Show:
- member address
- epoch
- storage locator / 0G root hash
- publish tx hash
- manifest hash
- merkle root
- updater address / source when available

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

MVP note:
- focus is on swarm-scoped epoch rotation and wrapped-key bundle publication to 0G
- owner historical recovery / keygrant flows are deferred until after MVP stabilization

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
Owner-only historical key grant (post-MVP target).

Flags:
- `--to-epoch <N>`
- `--swarm <name>`

Behavior (post-MVP):
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

## 5) Agent commands

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

## `soulvault agent register`
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

## `soulvault agent update`
Update the existing ERC-8004 registration payload.

Flags:
- `--agent-id <id>`
- `--name <name>`
- `--description <text>`
- `--image <uri>`
- `--harness <name>`
- `--backup-command <cmd>`
- `--service <name=url>` (repeatable)

## `soulvault agent show`
Show the resolved local ERC-8004 registration payload.

## `soulvault agent render-agenturi`
Render the exact base64 `agentURI` string without broadcasting.

Notes:
- `identity ...` commands can remain as compatibility aliases during transition, but `agent ...` should be the preferred surface.

---

## 6) Manifest / messaging / watch commands

## `soulvault manifest update`
Update the current agent's manifest ref/hash on the active swarm.

## `soulvault msg post`
Post verified message metadata.

Flags:
- `--to <address>` (`address(0)` / omitted for broadcast)
- `--topic <topic>`
- `--payload-ref <ref>`
- `--payload-hash <hash>`
- `--ttl <seconds>`

MVP audience inference:
- plaintext/public payload + `to = address(0)` => public message
- encrypted payload + `to = address(0)` => swarm-encrypted broadcast
- encrypted payload + `to = recipient` => DM

`messageMode` is not an explicit contract field in MVP.

## `soulvault events watch`
Watch swarm events and react locally.

Responsibilities:
- show join requests
- show epoch rotations
- react to key grants
- react to file mapping updates
- react to `BackupRequested` by running local backup flow when appropriate
- optionally trigger restore suggestions / backup reminders
