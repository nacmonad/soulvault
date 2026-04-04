# SoulVault CLI TODO

## Reference docs for this TODO
Use these as the source of truth while implementing the next CLI phases:
- `README.md`
- `docs/protocol-v0.1.md`
- `docs/technologies.md`
- `contracts/MESSAGE_PROTOCOL.md`
- `cli/COMMANDS.md`
- `cli/WORKFLOWS.md`

## CLI shape preference
Prefer entity-first top-level commands over option-driven pseudo-entities:
- `soulvault organization ...`
- `soulvault swarm ...`
- `soulvault agent ...`

Examples:
- organization handles ENS root registration + public metadata
- swarm handles creation/join/approve/status
- agent handles registration/update/public identity helpers

## A) Agent identity create flow (ERC-8004 / OpenClaw agent)
- Public identity lane decision: deploy/use the ERC-8004 registry on Sepolia for MVP, while the SoulVault swarm contract remains on 0G Galileo.
- MVP `agentURI` policy: use base64 `data:application/json;base64,...` payloads directly in-registry to avoid external hosting.
- [x] Implement the real `soulvault identity create-agent` onchain transaction flow against the configured ERC-8004 registry adapter ABI.
- [x] Promote `soulvault agent register/update/show/render-agenturi` as the preferred UX, with `identity ...` retained only as compatibility aliases if needed.
- [x] Accept and validate required registry inputs from config/flags:
  - [x] `SOULVAULT_ERC8004_REGISTRY_ADDRESS`
  - [x] optional swarm contract address
  - [x] agent name / description / image
  - [x] repeatable service entries
- [x] Build the agent registration payload with SoulVault/OpenClaw metadata:
  - [x] `memberAddress`
  - [x] `harness=openclaw`
  - [x] `backupHarnessCommand=soulvault-harness-openclaw backup`
  - [x] optional swarm contract pointer
  - [x] portable base64 `agentURI`
- [x] Persist created identity details locally in `~/.soulvault/agent.json` and `~/.soulvault/config.json`.
- [x] Add `identity show` / update-path improvements so the local agent can inspect and refresh its onchain identity.
- [x] Deploy the minimal ERC-8004 registry adapter on Sepolia and store its address in env/config.
- [x] Verify a live registry create/update transaction end-to-end once the Sepolia registry contract address is deployed and configured.
  - deployed Sepolia registry adapter: `0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266`
  - live RustyBot registration: `agentId = 1`

## B) Backup publish flow (archive, encrypt, upload)
- [x] Keep the local agent backup flow working end-to-end:
  - [x] gather workspace content via trusted local path selection
  - [x] produce deterministic tar/tar.gz bundle
  - [x] encrypt with shared test `K_epoch`
  - [x] emit manifest with hashes and metadata
- [ ] Replace the current test-only encryption scaffold with the intended production crypto path (libsodium / XChaCha20-Poly1305) once the module/runtime issue is resolved.
- [x] Wire `backup push` to actual 0G upload using the TS SDK pattern:
  - [x] signer from local hot wallet
  - [x] Galileo RPC
  - [x] 0G storage indexer
  - [x] capture returned root hash / tx hash
- [x] Define and persist publication record shape in `~/.soulvault/last-backup.json`:
  - [x] storage locator/root hash
  - [x] publish tx hash
  - [x] manifest hash/material
  - [x] archive hash
  - [x] epoch indicator (`TEST_K_EPOCH` for now)
- [ ] Prepare for later swarm contract publication of member file mappings.

## C) Download, decrypt, and verify restore contents
- [x] Add a fetch path that can retrieve the uploaded encrypted artifact from 0G using the stored locator/root hash.
- [x] Decrypt the fetched artifact using the same shared test `K_epoch`.
- [x] Unpack or inspect restored output safely (archive-level verification in temp directory).
- [x] Compare restored contents against the current OpenClaw setup at archive/hash level.
- [x] Skip writing a destructive full restore over the live workspace.
- [x] Add file-level compare report after archive extraction to a temp directory (currently compares whichever key/default files exist in the backed-up workspace, including project files such as `package.json`, `tsconfig.json`, `src/index.ts`, `src/commands/identity.ts`, and `src/lib/0g.ts`).
- [x] Output verification summary showing whether the backup/restore roundtrip preserved contents exactly.

## Backup command metadata policy
- `backupHarnessCommand` should record the literal command that actually produces the backup artifact for the runtime/harness.
- If the runtime uses a native backup/export command, store that exact command.
- If the runtime currently uses a tar/workspace archive fallback, store that exact tar/archive command.
- Do not publish invented placeholder wrapper commands in ERC-8004 metadata if they are not really executable in the current environment.

## Signer role model
- Default policy: infer signer by command family rather than asking the user every time.
- **Admin signer** should back privileged org/swarm actions like `organization register-ens`, `organization fund-agent`, `join approve`, `epoch rotate`, and `keygrant`.
- **Agent signer** should back runtime/public-agent actions like `agent register`, `backup push`, `storage publish`, and agent-side join request.
- Ledger support should be added as a backend for the admin signer role.

## D) ENS integration (Ethereum/Sepolia-facing naming + discovery)
- [x] Add ENS config handling throughout the CLI using the dedicated env split:
  - [x] `SOULVAULT_ETH_RPC_URL`
  - [x] `SOULVAULT_ENS_RPC_URL`
  - [x] `SOULVAULT_ENS_CHAIN_ID`
  - [x] Sepolia ENS contract addresses from env
- [x] Implement initial ENS-aware provider/resolver helpers separate from the 0G swarm provider.
- [x] Define the first SoulVault ENS record schema for public-safe swarm/org metadata:
  - [x] `soulvault.swarmContract`
  - [x] `soulvault.chainId`
  - [ ] `soulvault.publicManifestUri`
  - [ ] `soulvault.publicManifestHash`
  - [ ] optional ERC-8004 references
- [x] Add CLI support for attaching optional ENS metadata to a swarm profile.
- [x] Add initial CLI helpers for ENS read/write flows on Sepolia devnet first.
- [ ] Support public vs private swarm posture:
  - [x] public swarm -> ENS name stored and public-safe records prepared
  - [x] private swarm -> no ENS binding required (operator/docs semantics clarified)
  - [x] semi-private swarm -> org ENS only, no direct swarm publication required (operator/docs semantics clarified)
  - [x] live public org root: `soulvault.eth`
  - [x] live public swarm subdomain: `ops.soulvault.eth`
- [x] Test plan: Rusty creates a SoulVault organization ENS name on Sepolia for development.
- [x] Test plan: first swarm under that org should use an ENS subname like `ops.<org>`.
- [ ] Define future agent subname workflow for swarm agents (not required for MVP swarm create).

### Suggested ENS terminology
- **Organization** = ENS root/app-owned name used as the public umbrella namespace
- **Swarm** = ENS subdomain beneath the organization name used for swarm-level public metadata
- **Agent** = optional deeper subdomain beneath a swarm or org name for public agent identity

Example hierarchy:
- organization: `soulvault.eth` *(or Sepolia-available equivalent for dev/test)*
- swarm: `ops.soulvault.eth`
- agent: `rusty.ops.soulvault.eth`

## E) Organization create / local organization profile scaffolding
- [x] Live milestone: registered `soulvault.eth` on Sepolia and persisted the confirmed org state locally.
- [x] Implement `soulvault organization create` in the real TypeScript CLI.
- [ ] Implement `soulvault organization fund-agent` for native gas funding of agent wallets.
- [ ] Implement `soulvault organization fund-swarm` for batch top-ups across known swarm agent wallets.
- [ ] Introduce explicit admin-signer configuration/wiring for organization-level commands.
- [x] Add local organization profile storage (likely under `~/.soulvault/organizations/`).
- [x] Capture and persist these fields in the organization profile:
  - [x] organization name / local slug
  - [x] ENS root name
  - [x] ETH/ENS RPC config
  - [x] visibility posture / publication policy
  - [x] owner wallet / treasury defaults
  - [ ] future org-level metadata pointers
- [x] Support a profile-only organization create flow before ENS write operations are fully wired.
- [x] Add optional ENS registration / binding workflow for organization create on Sepolia first.
- [x] Test plan: Rusty creates the SoulVault organization ENS root for development.

## G) Swarm epoch / rekey model across organizations
- [x] Explicitly model `K_epoch` as swarm-scoped, not organization-scoped, in the implementation.
- [ ] Introduce explicit admin-signer configuration/wiring for privileged swarm commands (`join approve`, `member remove`, `epoch rotate`, `keygrant`).
- [x] Ensure local key storage is indexed by swarm + epoch, not only by epoch number.
- [ ] Add CLI/operator messaging that membership changes in one swarm do not force rekey in sibling swarms.
- [ ] Define future policy hooks if an organization ever wants coordinated multi-swarm checkpointing without shared symmetric keys.

## F) Swarm create / local swarm profile scaffolding
- [x] Add `soulvault swarm member-identities --swarm <name>` to print public identity links/details for known swarm members.
- [x] MVP lookup strategy for `swarm member-identities`:
  - [x] resolve member wallets from swarm state first
  - [x] look up ERC-8004 identities by wallet against the configured registry on Sepolia
  - [x] merge in any known local agent/profile data
  - [x] render human-readable links/details plus machine-friendly JSON output
- [ ] Optional later lookup path:
  - [ ] enrich member identity output from ENS public manifest / public metadata pointers when available
- [x] Implement `soulvault swarm create` in the real TypeScript CLI.
- [x] Require or accept `--organization <ens-name|local-org-name>` so swarms can anchor under an organization namespace.
- [x] Add local swarm profile storage (likely under `~/.soulvault/swarms/`).
- [x] Capture and persist these fields in the swarm profile:
  - [x] parent organization reference
  - [x] swarm name
  - [x] 0G chain id / RPC
  - [x] owner address
  - [x] deployed contract address (when known)
  - [x] optional ENS name
  - [x] visibility posture (`public` / `private` / `semi-private`)
- [x] Allow `swarm create` to work in profile-only mode before contract deployment is wired.
- [x] If the parent organization has an ENS root, derive or validate the swarm ENS name beneath it (example: `ops.soulvault.eth`).
- [x] Add follow-on `swarm use`, `swarm list`, and `swarm status` state integration against the saved profiles.
- [x] Define initial deploy/configure flow for contract deployment support.
- [ ] Ensure the swarm profile model cleanly separates:
  - [x] SoulVault swarm RPC/chain config (0G)
  - [ ] ENS/Ethereum RPC config (Sepolia for dev/test)
- [ ] Add CLI output that clearly explains when ENS is advisory/public metadata vs when SoulVault contract state is authoritative.
- [x] Test plan: `soulvault swarm create --organization soulvault.eth --name ops` should prepare/use `ops.soulvault.eth` as the swarm ENS name.
- [x] Live milestone: deployed 0G swarm contract for `ops` and approved the first join request.
  - swarm contract: `0x72fC68297AE86aef652B61D46C0510b75E493A40`

## I) Event-driven backup request / watch / respond flow
- [ ] Add `soulvault swarm member-file-mapping --swarm <name> --member <address>` as the canonical operator command for inspecting the current member backup mapping.
- [x] Implement `soulvault swarm backup-request --swarm <name> --reason <text>` to call `requestBackup(...)` on the swarm contract.
- [x] Implement `soulvault swarm events watch --swarm <name>` (and `events list`) to poll/watch `BackupRequested` events.
- [ ] When a matching backup request is seen, run the backup/archive/encrypt/upload flow and publish the member file mapping.
- [ ] Add loud failure output when the agent does not have enough 0G gas/storage balance to upload the backup artifact.
- [x] Add operator-friendly status/fetch commands to inspect backup requests and resulting file mappings on the event side.
- [ ] Validate the two-terminal story:
  - [x] terminal 1 issues `backup request`
  - [x] terminal 2 runs watcher/respond flow (debug/watch side)
  - [ ] artifact lands in 0G and mapping is updated onchain

## H) Epoch bundle creation / publication
- [x] Implement `soulvault epoch rotate` as the next focused stream.
- [x] Generate a fresh swarm-scoped `K_epoch` for the target swarm.
- [x] Build the plaintext wrapped-key JSON bundle for all active members.
- [x] Upload the bundle JSON to 0G Storage.
- [x] Persist/emit `keyBundleRef` + `keyBundleHash` for the new epoch.
- [x] Add `soulvault epoch show-bundle --swarm <name>` for testability/verification.
- [x] Add `soulvault epoch decrypt-bundle-member --swarm <name>` (or similar) to unwrap the current member's entry and verify it matches the expected epoch key material.
- [x] Default behavior should verify/decode without printing raw `K_epoch` unless an explicit unsafe/dev flag is supplied.
- [x] Consider disabling raw key output in production contexts while still allowing member-side verification in dev/MVP.
- [ ] Keep owner escrow / historical epoch recovery explicitly deferred until after MVP.

## Notes
- `.env` should provide default signer/RPC settings, not be the sole home of organization identity.
- Expect 0..N local organizations in SoulVault state; use `soulvault organization use ...` to switch active org context.
- A single organization may own 0..N swarms.
- Current funded agent address: `0x33764cD26F5884BFf194D38ED00DBB249C130B10`
- Current runtime identity: `RustyBot` / `openclaw`
- Current shared test key path: `SOULVAULT_TEST_K_EPOCH`
- 0G swarm default: Galileo testnet (`16602`)
- ETH/ENS default devnet: Sepolia (`11155111`)
- Do not overwrite the live OpenClaw workspace during verification work; use temp/output directories and compare hashes/contents first.
