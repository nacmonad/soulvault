# SoulVault Technologies (Finalized v0)

## 1) Product Components
- **CLI + TUI control plane** (operator + agent workflows)
- **EVM smart contracts** (swarm governance, joins, epochs, membershipVersion, pointers, events)
- **Encrypted storage adapters** (0G Storage for ciphertext memories/backups in MVP)
- **ERC-8004 identity integration** (optional per-agent public identity + metadata sync)
- **Optional network overlay module** (WireGuard/relay in roadmap)

---

## 2) Language & Runtime Decisions

### CLI / TUI
**Decision: TypeScript (Node 20+)**

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

Primary testnet target (recommended):
- **Base Sepolia** or **Ethereum Sepolia**

Selection criteria:
- Stable faucet access
- Good RPC availability
- Sponsor alignment if applicable

**Default: Base Sepolia** unless sponsor track requires another.

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
- `ink` (TUI) or `blessed` (fallback)
- `ethers` (contracts/events/signing)
- `zod` (runtime schema validation)
- `pino` (structured logging)

### ERC-8004 Identity Support
- ERC-721-compatible identity registry integration
- JSON schema validation for base64 `agentURI` registration payloads
- helper commands to create/update per-agent ERC-8004 identities
- inject optional `harness` metadata during registration

### Crypto
- `libsodium-wrappers` (XChaCha20-Poly1305 for symmetric encryption; X25519 box for pubkey wrapping)
- Node `crypto` (SHA-256/HKDF helpers for post-MVP derived keys)

### 0G Storage
- 0G Storage SDK / CLI integration for upload, retrieval, and publication tracking
- capture storage locator + publish transaction hash after upload

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
- `postMessage(to, topic, seq, epoch, payloadRef, payloadHash, ttl)` — verified message metadata
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
- `swarm list/use`
- `join request/approve/reject/cancel`
- `member show/remove`
- `backup push / restore pull`
- `keygrant` (historical key grant for new/recovered joiners)
- `epoch rotate`
- `events watch / status`
- `agent create/status`
- `identity register/update/show`
- `identity create-agent`
- `identity render-agenturi`
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
- Owner escrow enabled: every wrapped-key bundle includes an `ownerEscrowEntry` so epoch key material is always recoverable by the owner.
- Recommended owner custody: hardware wallet (Ledger-class) for escrow key operations.

### Post-MVP
- Quorum escrow enabled: threshold-based recovery to avoid single owner-key dependency.
- Owner escrow may remain as emergency fallback depending on governance policy.

### Principle
Contract governs authorization and storage references. Key recovery and re-wrap happen offchain in authorized CLI tooling.

---

## 11) Final Stack Summary

- **App:** TypeScript/Node CLI + TUI
- **Contracts:** Solidity + Foundry
- **Chain:** Base Sepolia (default)
- **Storage:** 0G Storage (encrypted memories/backups in MVP)
- **Public identity:** ERC-8004 per agent (Model 1), optional but recommended for discovery/interoperability
- **Crypto:** libsodium (XChaCha20-Poly1305 + X25519 box) + Node crypto (HKDF post-MVP)
- **Automation:** Chainlink Automation (MVP+, trigger only)
- **Agent UX:** OpenClaw skill wrapper over CLI
- **Networking (roadmap):** WireGuard + optional managed relay
