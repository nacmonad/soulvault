# SoulVault CLI Commands Reference

Run all commands with `npx tsx apps/cli/src/index.ts` or the `soulvault` alias.

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

### `soulvault organization set-resolver`
Point a **registered** ENS name's resolver at the SoulVault PublicResolver. Idempotent — no-op (no tx, no signature) when the resolver is already correct. Repair for org names registered before the register flow wired the resolver atomically: without a resolver, `registry.resolver(orgNode) = 0x0`, standard ENS resolution of the org's records fails, and third-party ENS tooling sees nothing (SoulVault's own reads fall back to the pinned resolver, but that doesn't help external readers). Requires the name's owner as signer — 1 signature when a change is needed.

```
--organization <nameOrEns> Target organization (defaults to active); its ensName is repaired
--ens-name <name>          Explicit ENS name to repair (overrides --organization)
```

Example — defuse the org-node resolver landmine on an already-registered name:

```
soulvault organization set-resolver --organization soulvault-demo.eth
```

### `soulvault swarm create`
Create a swarm profile and deploy the `SoulVaultSwarm` contract on 0G Galileo. The contract's constructor takes `address initialTreasury`, which the CLI resolves using the following precedence:

1. `--treasury <addr>` explicit override (pass `0x0000000000000000000000000000000000000000` to deploy org-affiliated but treasury-less)
2. `--organization <x>`: auto-discover via ENSIP-11 `addr(orgNode, coinType)` on the org's ENS name, where `coinType = 0x80000000 | chainId`. Fails loudly if no treasury is published on that coinType.
3. Neither: **stealth mode** — deploys with `address(0)` as the treasury, does NOT touch ENS at all, does NOT mutate any parent `soulvault.swarms` list. The swarm exists only in local state and on-chain. Useful for swarms that deliberately skip discovery and fund their agents off-band.

**Visibility decides what reaches ENS.** It is an input, not a label describing what
happened — a `--private` swarm publishes nothing even when it has a parent org:

| Flag | ENS subdomain | Listed in org's `soulvault.swarms` | Effect |
|---|---|---|---|
| `--public` | bound | yes | Resolvable and enumerable by walking the org. Default when `--organization` is set. |
| `--semi-private` | bound | no | Resolvable by anyone who already knows the name; invisible to anyone enumerating the org. |
| `--private` | none | no | Nothing published. The swarm may still be org-affiliated and hold an org-funded treasury — all of that stays local and on-chain. Default without `--organization`. |

The three flags are mutually exclusive; passing more than one is an error rather than a
silent precedence win. Contradictory combinations are rejected **before** the contract is
deployed, so a rejected create costs no gas:

- `--ens-name` with `--private` — a private swarm publishes no name.
- `--public` / `--semi-private` without a parent org that has a registered ENS name — there
  is nothing to publish under.
- `--ens-name` that is not exactly one label below the org's name (`ops.acme.eth` is fine,
  `a.b.acme.eth` and `ops.other.eth` are not). The binder derives the label by stripping
  the org suffix, so a deeper name would create a subnode at one namehash while writing
  resolver records to another.

The org list mutation is read-modify-write — not atomic against concurrent writers.

```
--name <name>              [REQUIRED] Swarm name
--organization <nameOrEns> Parent organization (omit for stealth mode)
--treasury <address>       Explicit treasury override (including 0x0 to opt out)
--chain-id <id>            Chain ID (defaults to env SOULVAULT_CHAIN_ID)
--rpc <url>                RPC URL (defaults to env SOULVAULT_RPC_URL)
--owner <address>          Owner address
--contract <address>       Existing contract address (skip deployment)
--ens-name <name>          Custom ENS subdomain (must be one label below the org)
--public                   Bind the subdomain and list on the org (default with --organization)
--private                  Publish nothing to ENS (default without --organization)
--semi-private             Bind the subdomain but stay off the org's discovery list
```

### `soulvault swarm unpublish`
Retract a swarm's ENS presence **without removing the swarm**. Clears the subdomain's resolver records (`addr`, `soulvault.chainId`, `soulvault.swarmContract`), releases the subnode by zeroing its owner and resolver, and strips the label from the parent org's `soulvault.swarms` list. The contract stays deployed, the local profile stays in place, and membership/epochs are untouched.

This is the fix for a swarm that was published by mistake — including any swarm created before visibility gating landed, which could be marked `private` on disk while its subdomain was live. Use `swarm remove` instead when you actually want the swarm gone.

`--delist-only` stops halfway, taking a swarm from public to semi-private: still resolvable by name, no longer discoverable by walking the org.

**This stops the name resolving from now on. It cannot un-disclose anything** — every record was public on a public chain, and the transaction history is permanent. Anyone who read or indexed the name still has that data.

Order is deliberate: the org-list update runs first, and **if it fails the subdomain is left bound.** A released subnode whose label is still listed is not private in any honest sense, and unbinding is not safely retryable once done (clearing resolver records afterwards needs a node the release has already zeroed). Leaving ENS untouched keeps a re-run clean. For the same reason the recorded visibility only moves as far as the work that actually succeeded — the profile never claims to be more private than it is.

```
--swarm <nameOrEns>        [REQUIRED] Swarm to unpublish
--yes                      [REQUIRED] Skip confirmation prompt
--delist-only              Only strip the org-list label; keep the subdomain resolvable (public → semi-private)
```

### `soulvault swarm remove`
Remove a swarm from local state. Archives the profile to `~/.soulvault/swarms/.archived/<slug>.json` (preserves recoverability — the contract address, chain, and org linkage all stay on disk for a future `swarm reattach`), strips the swarm label from the parent org's ENS `soulvault.swarms` CBOR list, and leaves the on-chain contract deployed. The command refuses to run without `--yes` since both the local archive and the ENS list mutation are destructive to discovery.

`--ens-cleanup` additionally clears the subdomain's resolver records and releases the subnode — the same retraction `swarm unpublish` performs. It is opt-in because the archived profile is otherwise enough to reattach later. A failure here warns but does not abort the archive: a half-done removal is worse than a loud warning.

```
--swarm <nameOrEns>        [REQUIRED] Swarm to remove
--yes                      [REQUIRED] Skip confirmation prompt
--reason <text>            Record a reason in the archive entry
--ens-cleanup              Also clear the subdomain resolver records and release the subnode
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

### `soulvault swarm set-lane`
Re-point a swarm profile to a different ops lane (chainId + rpcUrl). The swarm contract itself is immovable — it lives where it was deployed — so this corrects where subsequent operations send transactions. Intended for the Sepolia-only ops-lane posture: the profile from an older run may still record 0G Galileo (16602) and would mis-route later commands.

```
--chain-id <id>            New ops-lane chain id (e.g. 11155111 for Sepolia)
--rpc <url>                New ops-lane RPC endpoint
--ens                      Also rewrite the `soulvault.chainId` AND `soulvault.swarmContract` text records on the swarm's ENS name (2 signatures)
--swarm <nameOrEns>        Target swarm (defaults to active)
```

At least one of `--chain-id` / `--rpc` is required. Returns `{ slug, chainId, rpcUrl, ensTextTxHash?, ensContractTextTxHash?, ensTextError? }`.

### `soulvault swarm list-sync`
Repair org-level discoverability: append the swarm's label to the parent org's CBOR `soulvault.swarms` list (1 signature). Use when the subdomain is bound (`<label>.<org>.eth` resolves, contract + chainId records present) but the append step of `swarm create` never landed — the swarm exists yet ENS discovery (dashboard Overview/Swarms, `organization` reads) can't see it. Idempotent; only `public` swarms may be listed unless `--force`.

```
--swarm <nameOrEns>        Target swarm (defaults to active)
--force                    List the swarm even though its visibility is not public
```

Returns `{ slug, organizationEnsName, label, alreadyListed, txHash?, swarms, appended }`.

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
Deploy a fresh `SoulVaultTreasury` contract on the ops lane (Sepolia as of 2026-09; one per organization per chain) and publish its address on the org's ENS name via an **ENSIP-11 multichain `addr` record** keyed by the chain's coinType (`0x80000000 | chainId`; Sepolia = `2158638759`, historical 0G = `2147500250`). Requires an existing organization profile; the ENS binding step is best-effort and skipped if the org has no registered ENS name (the profile is saved with `ensBinding.status = 'planned'` for a later fix-up). Saves the treasury profile to `~/.soulvault/treasuries/<orgSlug>.json`.

```
--organization <nameOrEns> Parent organization (defaults to active)
--force                    Replace the treasury for this org on the CURRENT chain (other chains are unaffected)
```

Treasury is org-scoped, one per chain: an org that operates on multiple chains holds multiple treasuries, each under its own ENSIP-11 coinType slot on the same ENS name — setting one doesn't clobber the others. The local profile mirrors this: `~/.soulvault/treasuries/<orgSlug>.json` holds a `treasuries` array with one entry per chain (`chainId`, `contractAddress`, `ownerAddress`, `deployment`, `ensBinding`). All treasury commands resolve the entry matching the current `SOULVAULT_CHAIN_ID`, so binding a second treasury on another chain never requires `--force` and never touches the first chain's entry. Re-running `treasury create` for the SAME chain requires `--force` and replaces that chain's entry (the previous contract itself is untouched on-chain).

Legacy profiles (a single treasury directly on the profile object) are migrated to the array shape automatically on first read.

The legacy single-valued `soulvault.treasuryContract` / `soulvault.treasuryChainId` text records used in earlier prototypes have been removed in favor of ENSIP-11.

### `soulvault treasury bind`
Attach an **already-deployed** `SoulVaultTreasury` to an organization. Recovery path when `treasury create` deployed the contract but the ENS binding failed (e.g. a partial wizard failure), or for treasuries deployed outside the CLI entirely.

Steps performed: validates the address, probes the contract on-chain (`owner()` must answer — anything else refuses to bind), publishes the address on the org ENS name via ENSIP-11 `addr` **and** upserts the `soulvault.treasuries` enumeration record (same 'planned' semantics as `create` when the org has no ENS name), and upserts the per-chain entry into the local treasury profile. If an entry for the CURRENT chain already exists pointing at a different address, it refuses unless `--force` is passed — entries for other chains are unaffected either way; rebinds of the same address keep the original `createdAt`. Warns when the on-chain owner differs from your signer.

```
--address <address>        Deployed SoulVaultTreasury contract address (required)
--organization <nameOrEns> Parent organization (defaults to active)
--force                    Replace the existing treasury entry for the CURRENT chain
```

Example recovery flow — binding the 0G Galileo treasury mined by the browser wizard while keeping the Sepolia entry intact (run from the ops lane for the target chain):

```
SOULVAULT_RPC_URL=https://evmrpc-testnet.0g.ai SOULVAULT_CHAIN_ID=16602 \
  soulvault treasury bind --address 0xabc...def --organization soulvault-demo
```

### `soulvault treasury list`
List all local treasury profiles across all organizations.

### `soulvault treasury list-sync`
Rebuild the org's `soulvault.treasuries` ENS discovery record from the local treasury profile. **Adds** locally-known chains that are missing on-chain; never removes existing entries (on-chain entries win on conflicts). No-op when the record already matches — no transaction, no signature. Repair path when the record was partially clobbered by a failed bind cycle, or for publishing treasuries bound on another machine. Mirrors `swarm list-sync`.

### `soulvault treasury status`
Show the treasury contract address, current balance, and owner — resolved for the current `SOULVAULT_CHAIN_ID`.

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

## World Identity (Selfie Check)

World ID / Selfie Check (Beta, credential 11) helpers backing the rehydrate-request
authorization gate: a requester's Selfie Check proof (liveness + face match, bound to
their wallet address as the signal) is verified by the author's node before a
document rehydration request is approved and the encrypted bundle is transmitted.

Configuration lives in `.env`:
- `WORLD_APP_ID` — `app_id` from the Developer Portal
- `WORLD_RP_ID` — World ID 4.0 relying-party id
- `WORLD_RP_SIGNING_KEY` — backend-only signing key secret (never client-side)
- `WORLD_ENVIRONMENT` — `staging` (simulator/sandbox) or `production`

### `soulvault world status`
Show World identity integration configuration state (configured values, action scope,
and what is missing).

### `soulvault world rp-signature`
Generate a backend RP signature for a Selfie Check proof request. The browser client
fetches this before opening the IDKit request flow; the signing key never leaves the node.

```
--action <action>          Action scoping the proof (default: soulvault-request-rehydrate)
```

### `soulvault world verify-proof`
Evaluate a rehydrate request against a Selfie Check proof (author-side gate). Checks
proof shape, signal binding (requester wallet), credential id (11), expiry, and
nullifier replay within the 90-day validity window. Exits non-zero on rejection.

```
--proof <json>             [REQUIRED] Selfie Check proof payload as JSON
--signal <value>           [REQUIRED] Expected signal (requester wallet address)
--nullifiers <csv>         Already-consumed nullifiers for the action
```

Note: PoC scope — proof verification runs through the pluggable verifier boundary
(`@soulvault/node/world-identity`, mock implementation). The real Developer Portal
verification call drops in once the Selfie Check feature flag is enabled for the app.

---

## Documents

The documents lane (redact → publish → grant → rehydrate) runs on the identity lane
(Sepolia) against the global `SoulVaultDocumentRegistry` singleton — a per-chain
registry, not org-scoped: external consumers publish, verify, and rehydrate without
swarm membership. On-chain events are the transport:

- `DocumentPublished(docHash, author, slotIds)` — integrity anchor; docHash =
  `artifact.documentId`, never the document itself.
- `RehydrationRequested(docHash, recipient, rehydrationPublicKey)` — a consumer's
  onchain hydration request: the request tx signature binds msg.sender to the
  rehydration public key, so the author's client wraps grants straight from the
  event (no pasted attestation JSON). Key rotation = re-request with a fresh key;
  the author grants against the latest request per recipient.
- `SlotKeyGranted(docHash, slotId, recipient, wrappedKey, ...)` — the grant event IS
  the key delivery (wrapped slot keys, `secp256k1-ecdh-aes-256-gcm`). No revocation.

Discovery (v1 / ENSv1 track, ticket 012 §D): the registry address is published on the
**protocol root ENS name** (default `soulvault.eth`, not org assets) as ENSIP-11
`addr(rootNode, coinType(chainId))` — the record `resolveDocumentRegistryAddress()` in
the dashboard reads. Resolution preference: localStorage override → ENS →
`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` (kind `document`) → bundle hint. A
`soulvault.documentRegistry` text record on the root name holds a **chain-keyed JSON
array** (mirroring `soulvault.treasuries`): one `{chainId, address, deployedAtBlock,
deployedAt}` entry per chain, so a second-chain deploy extends the record instead of
clobbering the first, and watchers know where to start
scanning. ENSv2 adoption is tracked in `docs/dashboard-ui/015-ensv2-adoption.md`.

Dashboard consumers: Overview and Organization panels derive document state from these
events via `useDocumentEvents` (reduced into a docHash → author/slots registry), and
authors/consumers listen through the same watcher (`kind: 'document'` sources).

### `soulvault document deploy-registry`
Deploy the `SoulVaultDocumentRegistry` singleton on the identity lane (Sepolia) and
announce it on the protocol root ENS name. The announce step writes the ENSIP-11
`addr` record (discovery source of truth) and the `soulvault.documentRegistry` text
record (enumeration + `deployedAtBlock` for event scan windows). **The signer must
own the root ENS name.** Run `forge build` from the repo root first (the deploy loads
the Foundry artifact).

```
--root-ens-name <name>  Protocol root ENS name (default: the active organization's
                        ensName, then soluvault.eth)
--chain-id <id>         Chain to announce for (default: 11155111 Sepolia)
--skip-ens              Deploy only; skip the ENS announce step
```

### `soulvault document announce-registry`
Announce an **already-deployed** registry — the recovery path when the dashboard
wizard's deploy step landed on-chain but a later step (ENS addr / text record) failed.
Same two ENS writes as `deploy-registry`, but no contract deploy: pass the wizard's
registry address plus the deploy tx hash (its receipt supplies the scan-start block).

```
--address <addr>        Deployed SoulVaultDocumentRegistry address (required)
--root-ens-name <name>  Protocol root ENS name (default: active org's ensName)
--chain-id <id>         Chain to announce for (default: 11155111 Sepolia)
--deployed-at-tx <hash> Deploy tx hash; receipt supplies deployedAtBlock
--deployed-at-block <n> Alternative to --deployed-at-tx
```

Prints the deployment `{registry, owner, txHash, blockNumber}`, the ENS announce tx
hashes, and an optional `NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS` snippet
(`{"kind":"document",...}`) as a fallback for dashboards without ENS discovery.

### `soulvault document publish`
Anchor a redacted document on the DocumentRegistry: `publishDocument(docHash,
slotIds)` emits `DocumentPublished(docHash, author, slotIds)` — the integrity
anchor and the grant-authority anchor. The document itself never touches the
chain; the redacted artifact + encrypted slots travel as the public JSON bundle.
This is the recovery path for the dashboard redact page's publish wizard (same
registry resolution: ENSIP-11 `addr` on the protocol root name, then the text
record). Idempotent for the same author — the contract allows republishing your
own docHash, so a failed confirmation can be retried. Registry resolution:
ENSIP-11 `addr(rootName, coinType(chainId))` → `soulvault.documentRegistry` text
record entry for the chain.

```
--doc-hash <hash>       32-byte document hash (the bundle artifact.documentId)
--slot-id <id...>       Slot ids to publish (repeatable)
--bundle <path>         Public document bundle JSON file — derives --doc-hash and
                        --slot-id from artifact (overrides the individual flags)
--registry <addr>       Registry address (default: ENS discovery on the protocol root name)
--root-ens-name <name>  Protocol root ENS name (default: active org's ensName)
--chain-id <id>         Chain the registry is announced for (default: 11155111)
```

Example — publish straight from a downloaded bundle:

```bash
pnpm soulvault document publish --bundle c9cde9591206cac5.soulvault.json
Prints `{registry, docHash, slotIds, txHash, blockNumber}`.

### `soulvault document rehydration-key`
Print (or create) the **local rehydration key** for the active signer — persisted at
`~/.soulvault/keys/rehydration-<keyId>.json` (0600) and reused across restarts. The
public key + fingerprint are safe to share; this is what authors wrap grants to.
```
--key-id <id>     Rehydration key slot (default: "default")
--replace-key     Generate a FRESH key (key-loss recovery only — grants wrapped to
                  the old key will no longer unwrap; fail closed)
--json            Machine-readable JSON {keyId, publicKey, fingerprint}
```

### `soulvault document request-rehydrate`
**Recipient side.** Ask for hydration of a published document:
`requestRehydration(docHash, rehydrationPublicKey)` from the active signer. The tx
signature binds `msg.sender` to the rehydration public key — the `RehydrationRequested`
event is the wallet-attested key binding, so no EIP-712 attestation file is needed on
this path. Idempotent-ish: re-running re-announces the same key (fine); use
`--replace-key` only for key-loss recovery.
```
--doc-hash <hash>       32-byte document hash (the bundle artifact.documentId) (required)
--registry <addr>       Registry address (default: ENS discovery on the protocol root name)
--root-ens-name <name>  Protocol root ENS name (default: active org's ensName)
--chain-id <id>         Chain (default: 11155111)
--key-id <id>           Rehydration key slot (default: "default")
--replace-key           Fresh key (key-loss recovery only)
```
Prints `{registry, docHash, recipient, rehydrationPublicKey, rehydrationKeyFingerprint,
txHash, blockNumber}`.

### `soulvault document requests`
**Author side (read-only).** List `RehydrationRequested` events — who wants hydration
and the public key to wrap to. No wallet prompt.
```
--doc-hash <hash>       Filter to one document
--recipient <addr>      Filter to one recipient wallet
--registry <addr>       Registry address (default: ENS discovery)
--root-ens-name <name>  Protocol root ENS name (default: active org's ensName)
--chain-id <id>         Chain (default: 11155111)
--from-block <n>        Scan start (default: recent window — public RPCs reject
                        unbounded historic scans)
--json                  Machine-readable JSON
```

### `soulvault document grants`
Read `SlotKeyGranted` events — the permanent capability log (spec §3: no revoke, no
expiry in v0). Recipients check what they can unwrap; authors audit deliveries.
```
--doc-hash <hash>       Filter to one document
--recipient <addr>      Filter to one recipient wallet
--slot-id <id>          Filter to one slot
--registry <addr>       Registry address (default: ENS discovery)
--root-ens-name <name>  Protocol root ENS name (default: active org's ensName)
--chain-id <id>         Chain (default: 11155111)
--from-block <n>        Scan start (default: recent window)
--json                  Machine-readable JSON
```

### `soulvault document grant`
**Author side.** Wrap slot keys to the recipient's rehydration public key and deliver
via `grantSlotKey` — one tx per slot (the v0 contract shape; signing costs dominate,
keep lists short). By default the recipient's pubkey is read from their latest
`RehydrationRequested` event; pass `--recipient-public-key` to override. Requires the
**in-session slot keys** from the redact run: pass `--session` (a JSON export of the
redact page's `{slotKeys: [{slotId, key}…]}`) or explicit `--slot-key slotId=hex`
pairs. **Only the publishing author can grant** (contract-enforced). Grants are
permanent once delivered — double-check the slot list before signing.
```
--doc-hash <hash>             32-byte document hash (required)
--recipient <addr>            Recipient wallet = the requester (required)
--slot-id <id...>             Slots to grant (repeatable; defaults to all provided keys)
--slot-key <slotId=hex...>    Explicit slot keys (repeatable)
--session <path>              JSON file with {"slotKeys":[{"slotId","key"}…]}
--recipient-public-key <hex>  Recipient rehydration public key (default: from their
                              RehydrationRequested event)
--registry <addr>             Registry address (default: ENS discovery)
--root-ens-name <name>        Protocol root ENS name
--chain-id <id>               Chain (default: 11155111)
```
**Session-key warning:** slot keys are minted fresh per redact run and live only in
the redacting tab's `sessionStorage` (dashboard). Grants made from a session whose
bundle was never exported are undecryptable orphans — export the bundle and the slot
keys **from the same run** before granting.

### `soulvault document rehydrate`
**Recipient side.** Rehydrate a public document bundle from onchain grants: pulls
`SlotKeyGranted` events for the wallet, unwraps each with the local rehydration key,
and substitutes the granted slots. **Partial by design** — ungranted slots keep their
`{{sv:…}}` markers (selective disclosure). This is the terminal step of the
publish → request → grant → rehydrate loop.
```
--bundle <path>         Public document bundle JSON file (*.soulvault-*.json) (required)
--doc-hash <hash>       Filter grants to one document (default: any)
--recipient <addr>      Recipient wallet (default: active signer address)
--registry <addr>       Registry address (default: ENS discovery)
--root-ens-name <name>  Protocol root ENS name
--chain-id <id>         Chain (default: 11155111)
--key-id <id>           Rehydration key slot (default: "default")
--from-block <n>        Scan start for grant events (default: recent window)
--json                  Emit the full result {registry, recipient, grantedSlotIds, document}
```
Example — the full loop as two agents (author = `soulvault.eth` owner, recipient =
Charlie):

```bash
# recipient (Charlie) — once, then reuse across restarts:
soulvault document rehydration-key                       # print/share the pubkey
soulvault document request-rehydrate --doc-hash 0xc9cd…   # onchain request

# author — after redact + publish (same session as the bundle!):
soulvault document requests                              # see who's waiting
soulvault document grant --doc-hash 0xc9cd… \
  --recipient 0xdC48… \
  --session redact-session.json --slot-id pii-email-address-1jtoanl

# recipient — reveal granted slots only:
soulvault document rehydrate --bundle c9cde959…soulvault.json
```
Prints the rehydrated document with granted slots in plaintext and ungranted slots as
`{{sv:…}}` markers.
