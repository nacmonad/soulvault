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
- [x] Implement the real `soulvault identity create-agent` onchain transaction flow against the configured ERC-8004 registry adapter ABI.
- [ ] Promote `soulvault agent register/update/show/render-agenturi` as the preferred UX, with `identity ...` retained only as compatibility aliases if needed.
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
- [ ] Verify a live registry create/update transaction end-to-end once a concrete ERC-8004 registry contract address is provided.

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

## D) ENS integration (Ethereum/Sepolia-facing naming + discovery)
- [ ] Add ENS config handling throughout the CLI using the dedicated env split:
  - [ ] `SOULVAULT_ETH_RPC_URL`
  - [ ] `SOULVAULT_ENS_RPC_URL`
  - [ ] `SOULVAULT_ENS_CHAIN_ID`
  - [ ] Sepolia ENS contract addresses from env
- [ ] Implement ENS-aware provider/resolver helpers separate from the 0G swarm provider.
- [ ] Define the first SoulVault ENS record schema for public-safe swarm/org metadata:
  - [ ] `soulvault.swarmContract`
  - [ ] `soulvault.chainId`
  - [ ] `soulvault.publicManifestUri`
  - [ ] `soulvault.publicManifestHash`
  - [ ] optional ERC-8004 references
- [ ] Add CLI support for attaching optional ENS metadata to a swarm profile.
- [ ] Add CLI helpers for ENS read/write flows on Sepolia devnet first.
- [ ] Support public vs private swarm posture:
  - [ ] public swarm -> ENS name stored and public-safe records prepared
  - [ ] private swarm -> no ENS binding required
  - [ ] semi-private swarm -> org ENS only, no direct swarm publication required
- [ ] Test plan: Rusty creates a SoulVault organization ENS name on Sepolia for development.
- [ ] Test plan: first swarm under that org should use an ENS subname like `ops.<org>`.
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
- [ ] Implement `soulvault organization create` in the real TypeScript CLI.
- [ ] Implement `soulvault organization fund-agent` for native gas funding of agent wallets.
- [ ] Implement `soulvault organization fund-swarm` for batch top-ups across known swarm agent wallets.
- [ ] Add local organization profile storage (likely under `~/.soulvault/organizations/`).
- [ ] Capture and persist these fields in the organization profile:
  - [ ] organization name / local slug
  - [ ] ENS root name
  - [ ] ETH/ENS RPC config
  - [ ] visibility posture / publication policy
  - [ ] owner wallet / treasury defaults
  - [ ] future org-level metadata pointers
- [ ] Support a profile-only organization create flow before ENS write operations are fully wired.
- [ ] Add optional ENS registration / binding workflow for organization create on Sepolia first.
- [ ] Test plan: Rusty creates the SoulVault organization ENS root for development.

## G) Swarm epoch / rekey model across organizations
- [ ] Explicitly model `K_epoch` as swarm-scoped, not organization-scoped, in the implementation.
- [ ] Ensure local key storage is indexed by swarm + epoch, not only by epoch number.
- [ ] Add CLI/operator messaging that membership changes in one swarm do not force rekey in sibling swarms.
- [ ] Define future policy hooks if an organization ever wants coordinated multi-swarm checkpointing without shared symmetric keys.

## F) Swarm create / local swarm profile scaffolding
- [ ] Implement `soulvault swarm create` in the real TypeScript CLI.
- [ ] Require or accept `--organization <ens-name|local-org-name>` so swarms can anchor under an organization namespace.
- [ ] Add local swarm profile storage (likely under `~/.soulvault/swarms/`).
- [ ] Capture and persist these fields in the swarm profile:
  - [ ] parent organization reference
  - [ ] swarm name
  - [ ] 0G chain id / RPC
  - [ ] owner address
  - [ ] deployed contract address (when known)
  - [ ] optional ENS name
  - [ ] visibility posture (`public` / `private` / `semi-private`)
- [ ] Allow `swarm create` to work in profile-only mode before contract deployment is wired.
- [ ] If the parent organization has an ENS root, derive or validate the swarm ENS name beneath it (example: `ops.soulvault.eth`).
- [ ] Add follow-on `swarm use`, `swarm list`, and `swarm status` state integration against the saved profiles.
- [ ] Define deploy/configure flow for later contract deployment support.
- [ ] Ensure the swarm profile model cleanly separates:
  - [ ] SoulVault swarm RPC/chain config (0G)
  - [ ] ENS/Ethereum RPC config (Sepolia for dev/test)
- [ ] Add CLI output that clearly explains when ENS is advisory/public metadata vs when SoulVault contract state is authoritative.
- [ ] Test plan: `soulvault swarm create --organization soulvault.eth --name ops` should prepare/use `ops.soulvault.eth` as the swarm ENS name.

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
