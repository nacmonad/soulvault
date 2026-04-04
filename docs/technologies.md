# SoulVault Technologies (Finalized v0)

## 1) Product Components
- **CLI + TUI control plane** (operator + agent workflows)
- **EVM smart contracts** (swarm governance, joins, epochs, membershipVersion, pointers, events)
- **Encrypted storage adapters** (0G Storage for ciphertext memories/backups in MVP)
- **ERC-8004 identity integration** (optional per-agent public identity + metadata sync)
- **ENS integration** (optional public naming + swarm/organization discovery)
- **Optional network overlay module** (WireGuard/relay in roadmap)

---

## 2) Language & Runtime Decisions

### CLI / TUI
**Decision: TypeScript (Node 20+)**

Primary command model:
- `soulvault organization ...`
- `soulvault swarm ...`
- `soulvault agent ...`

Helper surfaces may remain for operational tasks (`backup`, `restore`, `storage`, `events`), but the owning entity should remain obvious.

Why:
- Fastest path for web3 + contract event handling
- Great Ethereum ecosystem tooling (`ethers`, `viem`)
- Easy JSON/IPC/process orchestration for bootstrap tasks
- Good TUI options (`ink`, `blessed`, `neo-blessed`)
- Reuse logic later inside OpenClaw skill wrappers

Alternative (Go):
- Better static binaries and ops footprint
- More engineering time for rich web3/TUI parity
- Better candidate for v2 rewrite if needed

**Conclusion:** TypeScript for hackathon velocity.

### Smart Contracts
**Decision: Solidity + Foundry**

Why Foundry:
- Very fast test/dev loop
- Excellent scripting/deploy workflows
- Easy event-driven testing and fuzzing

Alternative: Hardhat — great plugin ecosystem, heavier DX for rapid protocol iteration.

**Conclusion:** Foundry for contracts.

---

## 3) Networks / Testnets

Primary testnet target:
- **0G Galileo Testnet**

Current working network defaults:
- **RPC:** `https://evmrpc-testnet.0g.ai`
- **Chain ID:** `16602`
- **Storage indexer (turbo):** `https://indexer-storage-testnet-turbo.0g.ai`

Selection rationale:
- native fit for 0G Storage-backed encrypted backup publication
- aligns with the 0G TypeScript starter kit / SDK path
- supports the signer-backed upload model SoulVault needs

---

## 4) Core Libraries

### Required Utilities
- **EVM RPC provider** (read/write contract state + events)
- **0G upload/download adapter** (SDK/CLI-backed storage publication and retrieval)
- **Local secure key store** (store agent private key + unwrapped epoch keys, indexed by epoch number)
- **Archive utilities** (`tar`/`gzip`) for deterministic bundles
- **Hashing utilities** (SHA-256 for file/archive/manifest hashes)
- **KDF utilities** (HKDF for post-MVP derived keys)
- **Process/system utils** for bootstrap/install orchestration

> Each agent does **not** need to run additional storage infrastructure locally for MVP. SoulVault can publish encrypted artifacts to 0G Storage and retain the resulting storage locator + publish transaction hash.

### CLI / App
- `typescript`
- `commander` (CLI commands)
- `chalk` (terminal UX)
- `ink` (TUI) or `blessed` (fallback)
- `ethers` (contracts/events/signing)
- `zod` (runtime schema validation)
- `pino` (structured logging)
- `dotenv` (env loading)
- `fs-extra` (filesystem helpers)
- `tar` (deterministic archive creation)

### ERC-8004 Identity Support
- MVP deployment target: Sepolia
- current deployed SoulVault registry adapter (dev): `0xfFb7D6E80E962f3A6c7FB29876C97c37F088a266`
- ERC-721-compatible identity registry integration
- JSON schema validation for base64 `agentURI` registration payloads
- helper commands to create/update per-agent ERC-8004 identities
- inject optional `harness` metadata during registration
- store base64 `agentURI` directly in-registry for MVP to avoid external hosting requirements

### ENS Integration
- optional public naming/discovery for organizations and swarms
- support for organization root names and agent/swarm subnames
- recommended hierarchy: organization root -> swarm subdomain -> optional agent subdomain
- expected operational model for SoulVault-on-0G: ENS lives on Ethereum-facing ENS infrastructure (Sepolia by default for dev/test) and points at 0G-deployed SoulVault contracts/metadata
- optional ENS text records pointing to:
  - swarm contract address
  - chain id
  - public manifest URI/hash
  - ERC-8004 identity references
- ENS remains advisory/public metadata, not authorization state
- config should therefore expose separate RPCs for:
  - SoulVault swarm operations on 0G
  - ENS reads/writes on Ethereum
- Sepolia development defaults should also expose explicit ENS contract addresses (registry, registrar, controller, public resolver, universal resolver)

### Crypto
- `libsodium-wrappers` (XChaCha20-Poly1305 for symmetric encryption; X25519 box for pubkey wrapping)
- Node `crypto` (SHA-256/HKDF helpers for post-MVP derived keys)

### 0G Storage
- `@0gfoundation/0g-ts-sdk`
- signer-backed upload flow using chain RPC + storage indexer
- capture storage locator/root hash + publish transaction hash after upload
- downloads use root hash + indexer and do not require signing

### Contract Dev
- Foundry (`forge`, `cast`, `anvil`)

---

## 5) Key Contract Methods (MVP)

- `requestJoin(pubkey, pubkeyRef, metadataRef)` — pubkey stored in calldata and member record
- `approveJoin(requestId)` — activates member, increments `membershipVersion`
- `removeMember(member)` — deactivates member, increments `membershipVersion`
- `rotateEpoch(newEpoch, keyBundleRef, keyBundleHash, expectedMembershipVersion)` — reverts if `membershipVersion` has changed
- `grantHistoricalKeys(member, bundleRef, bundleHash, fromEpoch, toEpoch)` — emits `HistoricalKeyBundleGranted`
- `updateMemberFileMapping(member, storageLocator, merkleRoot, publishTxHash, manifestHash, epoch)` — explicit Option B per-member file mapping update
- `postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)` — verified message metadata for public, swarm-encrypted, or DM payloads (audience inferred in MVP)
- `requestBackup(epoch, reason, targetRef, deadline)` — emits coordinated swarm backup trigger event
- `updateAgentManifest(manifestRef, manifestHash)` — emits `AgentManifestUpdated`

---

## 6) Chainlink Integration Scope

### MVP+
- **Chainlink Automation** triggers `requestRekey()` (public function) when membership has changed without a follow-up rekey, or when backup staleness thresholds are exceeded.
- Emits `RekeyRequested(trigger, membershipVersion)`.
- Owner CLI responds to this event and performs the actual rekey.

### What Chainlink does not do
- Hold or access private keys or symmetric keys
- Execute rekey crypto operations

### Out of MVP
- CCIP (cross-chain messaging)
- Complex oracle-driven policy engines

---

## 7) OpenClaw Integration

Deliverable: `skills/soulvault/` skill wrapping CLI

Expected skill operations:
- `organization create/list/use/status`
- `organization register-ens/update-metadata`
- `organization fund-agent/fund-swarm`
- `swarm create/list/use/status`
- `join request/approve/reject/cancel`
- `member show/remove`
- `backup request/push/show`
- `restore pull`
- `keygrant` (historical key grant for new/recovered joiners)
- `epoch rotate`
- `events watch / status`
- `agent create/status`
- `agent register/update/show`
- `agent render-agenturi`
- future: optional ENS sync / record update helpers
- `storage publish` / `storage fetch`

---

## 7.1) Implementation Folder Layout

Initial implementation layout:
- `contracts/`
  - `ISoulVaultSwarm.sol`
  - swarm contract specs / notes
  - ERC-8004 integration notes (agent identity is external to SoulVault)
- `cli/`
  - command tree spec
  - workflow spec
  - later TypeScript command handlers / subcommands

This split keeps the swarm contract surface and the operator/agent command surface explicit from the beginning.

## 8) Packaging / Release

- CLI packaged as npm binary (`soulvault`)
- Optional Docker image for reproducible VPS bootstrap
- Bootstrap script shipped in repo/release with checksums/signatures

---

## 9) WireGuard / Relay Positioning (Post-MVP)

WireGuard does not require a proprietary relay by default, but NAT traversal often benefits from:
- Public coordination server
- Optional relay for unreachable peers

Product options:
1. **Open-source self-hosted mode** (users run their own relay/control-plane)
2. **Managed relay service** (hosted convenience layer with SLA, monitoring, audit logs)

Keep protocol portable — users should never be locked into managed infrastructure.

---

## 10) Key Custody Policy

### MVP
- Agent operations use a local software wallet (mnemonic or private key) for autonomous uploads, file mapping publication, and ERC-8004 identity actions.
- Owner escrow enabled: every wrapped-key bundle includes an `ownerEscrowEntry` so epoch key material is always recoverable by the owner.
- Ledger-class hardware wallet is recommended later for owner/governance operations, but is not mandatory for MVP.

### Post-MVP
- Quorum escrow enabled: threshold-based recovery to avoid single owner-key dependency.
- Owner escrow may remain as emergency fallback depending on governance policy.

### Principle
Contract governs authorization and storage references. Key recovery and re-wrap happen offchain in authorized CLI tooling.

---

## 11) Final Stack Summary

- **App:** TypeScript/Node CLI + TUI
- **Contracts:** Solidity + Foundry
- **Chain:** 0G Galileo Testnet (`16602`)
- **Storage:** 0G Storage (encrypted memories/backups in MVP)
- **Public identity:** ERC-8004 per agent on Sepolia (Model 1), optional but recommended for discovery/interoperability
- **Public namespace/discovery:** ENS on Sepolia for optional swarm/org naming and agent subnames
- **Crypto:** libsodium (XChaCha20-Poly1305 + X25519 box) + Node crypto (HKDF post-MVP)
- **Automation:** Chainlink Automation (MVP+, trigger only)
- **Agent UX:** OpenClaw skill wrapper over CLI
- **Networking (roadmap):** WireGuard + optional managed relay
