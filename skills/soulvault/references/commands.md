# SoulVault CLI Commands Reference

Run all commands with `npx tsx cli/src/index.ts` or the `soulvault` alias.

---

## Status

### `soulvault status`
Unified dashboard showing wallet, agent, organization, swarm, on-chain state, local epoch keys, last backup, and environment configuration in a single view.

```
--json                     Output raw JSON instead of human-readable text
--offline                  Skip on-chain RPC calls (local state only)
```

Sections displayed:

| Section | Source | Data |
|---------|--------|------|
| Wallet | env / agent profile | signer mode, address, public key |
| Agent | `~/.soulvault/agent.json` | name, harness, ERC-8004 agentId |
| Organization | `~/.soulvault/organizations/<active>.json` | name, ENS, visibility, registration status |
| Swarm | `~/.soulvault/swarms/<active>.json` | name, ENS, contract address, chain ID |
| On-chain | RPC to swarm contract | epoch, member count, membership version, your membership status, contract owner |
| Local Keys | `~/.soulvault/keys/<swarm>/` | count of epoch key files, latest epoch number |
| Last Backup | `~/.soulvault/last-backup.json` | timestamp, epoch, 0G root hash, workspace path |
| Environment | `.env` config | ops RPC, identity RPC, 0G indexer URL, profile, state directory |

On-chain calls degrade gracefully — if the RPC is unreachable the section shows `(unreachable)` instead of failing.

---

## Sync

### `soulvault sync`
Rebuild local `~/.soulvault/organizations/*.json` and `swarms/*.json` from ENS (`soulvault.swarmContract`, `soulvault.chainId`) and on-chain checks. The signer wallet must be the ENS owner of each org and the `owner()` of each swarm contract on the ops chain. Optionally discovers ERC-8004 agents for the same wallet when `SOULVAULT_ERC8004_REGISTRY_ADDRESS` is set.

```
--organization-ens <names>   Comma-separated org ENS names (overrides SOULVAULT_SYNC_ORGANIZATION_ENS)
--swarm-ens <names>          Comma-separated swarm ENS names (overrides SOULVAULT_SYNC_SWARM_ENS)
```

With `SOULVAULT_SIGNER_MODE=ledger` and `SOULVAULT_LEDGER_AUTO_SYNC=true`, the same sync runs automatically after the Ledger address is resolved (no second run when using this command: sync skips the nested auto-sync).

---

## Organization

### `soulvault organization create`
Create a local organization profile with optional ENS root name.

```
--name <name>              [REQUIRED] Organization name
--ens-name <name>          Root ENS name (e.g., soulvault.eth)
--owner <address>          Owner address (defaults to signer)
--public                   Mark as publicly discoverable
--private                  Mark as private
--semi-private             Mark as semi-private
```

### `soulvault organization list`
List all local organization profiles.

### `soulvault organization use <nameOrEns>`
Set the active organization context for subsequent commands.

### `soulvault organization status`
Show active organization details (profile, ENS state, visibility).

```
--organization <nameOrEns> Target organization (defaults to active)
```

### `soulvault organization set-ens-name`
Attach a root `.eth` name to an **existing** local profile when `create` was run without `--ens-name`. Updates `~/.soulvault/organizations/<slug>.json` (not `config.json`). Does not register on-chain — run `register-ens` after.

```
--organization <nameOrSlug>  Organization slug, display name, or prior ensName
--ens-name <name>            Root ENS name (e.g. soulvault-ledger.eth)
```

### `soulvault organization register-ens`
Register the organization's ENS root name on Sepolia. Two-step commit+register flow (with the mandatory `minCommitmentAge` wait in the middle). The registration struct passes the public resolver address, so the name is born with a resolver wired up. After successful registration, the command **also writes the organization metadata text records** on the ENS name following the draft ENSIP on organizational metadata: `class = soulvault.organization`, `name = <org.name>`. This metadata write is best-effort — if it fails, the registration itself is still durable and the user can re-run `register-ens` or use a future `organization set-metadata` command to retry. Fails loudly if the name is already taken.

```
--organization <nameOrEns> Target organization (defaults to active)
```

---

## Swarm

### `soulvault swarm create`
Create a swarm profile and deploy the `SoulVaultSwarm` contract on 0G Galileo. The contract's constructor takes `address initialTreasury`, which the CLI resolves using the following precedence:

1. `--treasury <addr>` explicit override (pass `0x0000000000000000000000000000000000000000` to deploy org-affiliated but treasury-less)
2. `--organization <x>`: auto-discover via ENSIP-11 `addr(orgNode, coinType)` on the org's ENS name, where `coinType = 0x80000000 | chainId`. Fails loudly if no treasury is published on that coinType.
3. Neither: **stealth mode** — deploys with `address(0)` as the treasury, does NOT touch ENS at all, does NOT mutate any parent `soulvault.swarms` list. The swarm exists only in local state and on-chain. Useful for swarms that deliberately skip discovery and fund their agents off-band.

When `--organization` is set and the parent has an ENS name, the command also binds an ENS subdomain (`<label>.<orgEnsName>`) and appends the swarm's label to the org's CBOR `soulvault.swarms` text record (read-modify-write — not atomic against concurrent writers).

```
--name <name>              [REQUIRED] Swarm name
--organization <nameOrEns> Parent organization (omit for stealth mode)
--treasury <address>       Explicit treasury override (including 0x0 to opt out)
--chain-id <id>            Chain ID (defaults to env SOULVAULT_CHAIN_ID)
--rpc <url>                RPC URL (defaults to env SOULVAULT_RPC_URL)
--owner <address>          Owner address
--contract <address>       Existing contract address (skip deployment)
--ens-name <name>          Custom ENS subdomain name
--public                   Mark as publicly discoverable
--private                  Mark as private
--semi-private             Mark as semi-private
```

### `soulvault swarm remove`
Remove a swarm from local state. Archives the profile to `~/.soulvault/swarms/.archived/<slug>.json` (preserves recoverability — the contract address, chain, and org linkage all stay on disk for a future `swarm reattach`), strips the swarm label from the parent org's ENS `soulvault.swarms` CBOR list, and leaves the on-chain contract deployed. The command refuses to run without `--yes` since both the local archive and the ENS list mutation are destructive to discovery.

```
--swarm <nameOrEns>        [REQUIRED] Swarm to remove
--yes                      [REQUIRED] Skip confirmation prompt
--reason <text>            Record a reason in the archive entry
--ens-cleanup              Also clear the swarm subdomain resolver records (not yet implemented)
```

### `soulvault swarm list`
List all local swarm profiles.

### `soulvault swarm use <nameOrEns>`
Set the active swarm context for subsequent commands.

### `soulvault swarm status`
Show active swarm details (contract address, chain, epoch, ENS).

```
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault swarm join-request`
Submit a join request to the swarm contract. Includes the local agent's secp256k1 public key in calldata.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--pubkey <hex>             Override default public key
--pubkey-ref <ref>         Storage reference for pubkey
--metadata-ref <ref>       Identity reference (ERC-8004, agent URL, etc.)
```

### `soulvault swarm approve-join`
Owner approves a pending join request. Activates the member and increments `membershipVersion`.

```
--request-id <id>          [REQUIRED] Join request ID
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault swarm join-status`
Check the status of a specific join request (pending, approved, rejected, cancelled).

```
--request-id <id>          [REQUIRED] Join request ID
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault swarm member-identities`
List all active swarm members with their ERC-8004 identity data. Bridges private swarm membership to public identity discovery.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
```

Output includes per member: wallet, active status, joinedEpoch, pubkey, `localAgentMatch` flag, and any ERC-8004 identities found.

### `soulvault swarm backup-request`
Owner triggers a coordinated backup wave by emitting `BackupRequested` on the swarm contract.

```
--reason <text>            [REQUIRED] Reason for the backup request
--swarm <nameOrEns>        Target swarm (defaults to active)
--epoch <n>                Specific epoch (defaults to current)
--target-ref <ref>         Storage target reference
--deadline-seconds <n>     Deadline in seconds (default: 3600)
```

### `soulvault swarm events list`
Query historical swarm contract events in a block range.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--from-block <n>           Start block
--to-block <n>             End block
```

### `soulvault swarm events watch`
Poll for live swarm events. Supports automated backup response via `--respond-backup`. When the swarm has a bound treasury, the watcher **automatically merges treasury events** (`FundsDeposited`, `FundsReleased`, `FundRequestRejectedByTreasury`, `TreasuryWithdrawn`) into the same stream as swarm events, sorted by `(blockNumber, logIndex)`. Each entry has a `source: 'swarm' | 'treasury'` discriminator.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--poll-seconds <n>         Polling interval (default: 5)
--from-block <n>           Start block
--once                     Poll once and exit
--respond-backup           Auto-execute full backup response on BackupRequested events
```

When `--respond-backup` is active, the watcher will:
1. Detect `BackupRequested` events
2. Run the configured harness backup command
3. Encrypt the archive with the epoch key
4. Upload to 0G Storage
5. Publish `updateMemberFileMapping` onchain
6. Fail loudly on insufficient 0G gas/storage balance

No equivalent auto-approve flag exists for fund requests — approval stays manual per v1 scope.

### `soulvault swarm set-treasury`
Swarm owner binds the swarm to a `SoulVaultTreasury` contract. Re-settable. Emits `TreasurySet(old, new, by)` on chain. Warns the operator if there are any pending fund requests at rebind time (they will be orphaned from the previous treasury because the mutual-consent check will fail).

```
--treasury <address>       [REQUIRED] Treasury contract address
--swarm <nameOrEns>        Target swarm (defaults to active)
```

After binding, refreshes the local swarm profile's cached `treasuryAddress` field.

### `soulvault swarm treasury-status`
Read the currently-bound treasury address from the swarm contract.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
```

Returns `{ swarm, contractAddress, treasuryAddress, isSet }`. `isSet` is `false` when the treasury is the zero address (unbound).

### `soulvault swarm fund-request`
Active swarm member submits a fund request. Requires: caller is an active member, treasury is bound, amount > 0, swarm not paused. Parses `FundRequested` from the receipt and prints the resulting `requestId`.

```
--amount <ether>           [REQUIRED] Requested amount in ether (whole units — parsed via parseEther)
--reason <text>            [REQUIRED] Free-form reason string (stored on-chain)
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault swarm cancel-fund-request`
Requester cancels their own pending fund request. Must be called by the same wallet that filed the request; the swarm contract enforces this.

```
--request-id <id>          [REQUIRED] Fund request ID
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault swarm fund-status`
Read the current state of a fund request by id.

```
--request-id <id>          [REQUIRED] Fund request ID
--swarm <nameOrEns>        Target swarm (defaults to active)
```

Returns `{ requester, amountWei, reason, status, statusLabel, createdAt, resolvedAt }`. `statusLabel` is one of `pending | approved | rejected | cancelled`.

### `soulvault swarm fund-requests list`
List all fund requests on the swarm by querying `FundRequested` events and joining with current on-chain status. Supports client-side status filtering.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--status <label>           Filter by pending | approved | rejected | cancelled
--from-block <n>           Start block (default: 0)
--to-block <n>             End block (default: latest)
```

### `soulvault swarm pause` / `unpause`
**NOT IMPLEMENTED IN CLI** (follow-up branch). The contract has `pause()` / `unpause()` with `onlyOwner` access control, and the `whenNotPaused` modifier guards all fund request operations. These commands are on the roadmap — see `contracts/IMPLEMENTATION_NOTES.md`. For now, use `cast send <swarm> "pause()"` or the raw ethers API if you need to exercise pause behavior manually.

---

## Treasury

### `soulvault treasury create`
Deploy a fresh `SoulVaultTreasury` contract on 0G Galileo (one per organization per chain) and publish its address on the org's ENS name via an **ENSIP-11 multichain `addr` record** keyed by the chain's coinType (`0x80000000 | chainId`). For 0G Galileo, the coinType is `2147500186`. Requires an existing organization profile; the ENS binding step is best-effort and skipped if the org has no registered ENS name (the profile is saved with `ensBinding.status = 'planned'` for a later fix-up). Saves the treasury profile to `~/.soulvault/treasuries/<orgSlug>.json`.

```
--organization <nameOrEns> Parent organization (defaults to active)
--force                    Overwrite an existing treasury profile for this org
```

Treasury is org-scoped: exactly one per organization per chain. An org that operates on multiple chains deploys multiple treasuries, each under its own ENSIP-11 coinType slot on the same ENS name — setting one doesn't clobber the others. Re-running `treasury create` for an org that already has a treasury requires `--force` and will overwrite the coinType slot (the previous contract itself is untouched).

The legacy single-valued `soulvault.treasuryContract` / `soulvault.treasuryChainId` text records used in earlier prototypes have been removed in favor of ENSIP-11.

### `soulvault treasury list`
List all local treasury profiles across all organizations.

### `soulvault treasury status`
Show the treasury contract address, current balance, and owner.

```
--organization <nameOrEns> Target organization (defaults to active)
```

Returns `{ organization, contractAddress, owner, balanceWei, balanceEther }`. Balance reads directly from `address(treasury).balance` on chain.

### `soulvault treasury deposit`
Send native value from the signer wallet into the treasury. Any wallet can deposit (not just the owner), so funders and approvers can be separated.

```
--amount <ether>           [REQUIRED] Amount in ether (whole units)
--organization <nameOrEns> Target organization (defaults to active)
```

Calls `treasury.deposit()` with `msg.value`. Emits `FundsDeposited(from, amount)`.

### `soulvault treasury withdraw`
Treasury owner withdraws native value to an arbitrary address. Owner-only (contract enforces `NotOwner` revert).

```
--to <address>             [REQUIRED] Recipient address
--amount <ether>           [REQUIRED] Amount in ether (whole units)
--organization <nameOrEns> Target organization (defaults to active)
```

### `soulvault treasury approve-fund`
Treasury owner approves a pending fund request on the given swarm and releases funds to the requester **in the same transaction**. Performs four on-chain actions atomically:
1. Mutual consent check (`ISoulVaultSwarm(swarm).treasury() == address(this)`)
2. Read request, verify `status == PENDING` and `balance >= amount`
3. Call `swarm.markFundRequestApproved(requestId)` (swarm-side status flip)
4. Native-value transfer from treasury to the original requester

Prints the parsed `FundsReleased` event (recipient, amountWei, txHash) on success.

```
--swarm <nameOrAddress>    [REQUIRED] Swarm slug (local profile) OR raw contract address
--request-id <id>          [REQUIRED] Fund request ID
--organization <nameOrEns> Target organization (defaults to active)
```

**Warning:** when `--swarm` is a raw address rather than a known profile slug, the CLI prints a warning — the treasury will release funds in the same tx if the call succeeds, so unverified swarm addresses should be rare and deliberate.

### `soulvault treasury reject-fund`
Treasury owner rejects a pending fund request. No funds move. Still performs the mutual consent check.

```
--swarm <nameOrAddress>    [REQUIRED]
--request-id <id>          [REQUIRED]
--reason <text>            [REQUIRED] Reason stored in both swarm and treasury events
--organization <nameOrEns> Target organization (defaults to active)
```

### `soulvault treasury fund-requests list`
Inspect fund requests across a swarm from the treasury owner's perspective. Identical output to `soulvault swarm fund-requests list` — the two commands exist because requesters and approvers naturally reach for different command groups.

```
--swarm <nameOrEns>        [REQUIRED]
--status <label>           Filter by pending | approved | rejected | cancelled
--from-block <n>
--to-block <n>
```

---

## Agent

### `soulvault agent create`
Create or load the local agent profile. Stored at `~/.soulvault/agent.json`.

```
--name <name>              Agent name
--harness <harness>        Harness/runtime type (default: openclaw)
--backup-command <command>  Custom backup command
```

Supported harness types: `openclaw`, `hermes`, `ironclaw`, `custom`.

### `soulvault agent status`
Show the local agent profile (name, address, pubkey, harness, backup command).

### `soulvault agent render-agenturi`
Render a base64-encoded ERC-8004 agent URI without registering onchain. Useful for previewing.

```
--name <name>              Agent name
--description <description> Agent description
--image <image>            Image URL
--registry <address>       ERC-8004 registry (defaults to env)
--swarm <nameOrEns>        Swarm for context (defaults to active)
--swarm-contract <address> Override swarm contract address
--service <type=url>       [REPEATABLE] Service entry (e.g., api=https://...)
```

### `soulvault agent register`
Register the agent identity onchain in the ERC-8004 registry on Sepolia. Returns the assigned `agentId`.

Same flags as `render-agenturi`.

### `soulvault agent update`
Update an existing onchain agent identity by `agentId`.

```
--agent-id <id>            [REQUIRED] Agent ID to update
```
Plus all flags from `render-agenturi`.

### `soulvault agent show`
Query onchain agent identity data from the ERC-8004 registry.

```
--agent-id <id>            Query a specific agent (defaults to wallet lookup)
--registry <address>       Override registry address
```

Supports both `agentIdsForWallet()` lookup and fallback sequential ID scan (up to 512).

---

## Identity (Legacy)

Legacy aliases for ERC-8004 operations. Prefer `agent` commands (they include swarm context resolution).

### `soulvault identity render-agenturi`
### `soulvault identity create-agent`
### `soulvault identity update`
### `soulvault identity show`

Same flags as agent equivalents, but without `--swarm` context resolution.

---

## Backup

### `soulvault backup push`
Archive the workspace, encrypt with the current epoch key (AES-256-GCM), upload to 0G Storage, and record the manifest locally.

```
--workspace <path>         Workspace to archive (default: cwd)
--skip-upload              Only create + encrypt locally, don't upload to 0G
```

Output includes: `archivePath`, `encryptedPath`, `manifest` (nonce, aad, authTag), `rootHash`, `txHash`.

---

## Restore

### `soulvault restore pull`
Decrypt an encrypted backup given the manifest parameters.

```
--encrypted <path>         [REQUIRED] Path to encrypted file
--nonce <hex>              [REQUIRED] Nonce (hex)
--aad <text>               [REQUIRED] Additional authenticated data
--auth-tag <hex>           [REQUIRED] Auth tag (hex)
--output <path>            [REQUIRED] Output path for decrypted archive
```

### `soulvault restore verify-latest`
End-to-end verification: download from 0G → decrypt → extract → compare SHA256 hashes of key files against source workspace.

```
--root-hash <hash>         Override 0G root hash to fetch
--skip-download            Use local encrypted artifact from last-backup.json
```

Compares files: `SOUL.md`, `USER.md`, `AGENTS.md`, `memory/*.md`, `package.json`, `tsconfig.json`, and source files.

---

## Epoch

### `soulvault epoch rotate`
Generate a new epoch key, wrap it per active member pubkey, upload the bundle to 0G, and call `rotateEpoch` on the swarm contract.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--new-epoch <n>            Explicit epoch number (defaults to current + 1)
```

Includes owner escrow entry in every bundle. Reverts if `membershipVersion` changed since bundle generation (concurrency guard).

### `soulvault epoch show-bundle`
Fetch and display the latest epoch bundle from 0G via the most recent `EpochRotated` event.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
```

### `soulvault epoch decrypt-bundle-member`
Decrypt the current member's wrapped key entry from the latest epoch bundle. Verifies it matches the locally stored epoch key.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--print-key                [UNSAFE/DEV] Print the raw unwrapped epoch key hex
```

---

## Messaging

### `soulvault msg post`
Post a message to the swarm. Uploads the message envelope to 0G Storage, then calls `postMessage` on the swarm contract with the 0G root hash as `payloadRef`.

Supports three message modes matching the MESSAGE_PROTOCOL.md spec:

| Mode | Encryption | `to` field | Who can read |
|------|-----------|------------|--------------|
| `public` | None (plaintext) | `address(0)` | Anyone |
| `group` | AES-256-GCM with K_epoch | `address(0)` | All swarm members with current epoch key |
| `dm` | secp256k1-ECDH + AES-256-GCM | Recipient address | Only the recipient (via their private key) |

```
--topic <topic>            [REQUIRED] Message topic (e.g., status, coordination, heartbeat)
--body <text>              [REQUIRED] Message body (plain text or JSON string)
--mode <mode>              Message mode: public, group, or dm (default: public)
--to <address>             Recipient address (required for dm mode)
--swarm <nameOrEns>        Target swarm (defaults to active)
--ttl <seconds>            Time-to-live in seconds (default: 3600)
```

The uploaded envelope includes:
- `version`, `encryption`, `contentType`, `from`, `to`, `topic`, `createdAt`
- For `group`: `ciphertext`, `nonce`, `aad`, `algorithm`, `epoch`
- For `dm`: `ciphertext`, `ephemeralPublicKey`, `nonce`, `algorithm`

Sequence numbers are auto-incremented (fetched from `getLastSenderSeq` onchain). Epoch is auto-resolved from contract.

### `soulvault msg list`
List all `AgentMessagePosted` events from the swarm contract.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--from-block <n>           Start block
--to-block <n>             End block
```

### `soulvault msg show`
Fetch a message envelope from 0G by its `payloadRef` and optionally decrypt it.

```
--payload-ref <ref>        [REQUIRED] 0G root hash of the message payload
--swarm <nameOrEns>        Target swarm (for group decryption epoch key lookup)
--decrypt                  Attempt to decrypt the message body
```

Decryption auto-detects mode from the envelope's `encryption` field:
- `aes-256-gcm` → uses local epoch key from `~/.soulvault/keys/`
- `secp256k1-ecdh-aes-256-gcm` → uses local signer private key
