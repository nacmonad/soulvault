# SoulVault Technologies (Finalized v0)

## 1) Product Components
- **CLI + TUI control plane** (operator + agent workflows)
- **EVM smart contracts** (swarm governance, joins, epochs, pointers, events)
- **Encrypted storage adapters** (IPFS for ciphertext artifacts)
- **Optional network overlay module** (WireGuard/relay in roadmap)

---

## 2) Language & Runtime Decisions

## CLI / TUI
**Decision: TypeScript (Node 20+)**

Why:
- Fastest path for web3 + contract event handling
- Great Ethereum ecosystem tooling (`ethers`, viem)
- Easy JSON/IPC/process orchestration for bootstrap tasks
- Good TUI options (`ink`, `blessed`, `neo-blessed`)
- Reuse logic later inside OpenClaw skill wrappers

Alternative (Go):
- Better static binaries and ops footprint
- More engineering time for rich web3/TUI parity
- Better candidate for v2 rewrite if needed

**Conclusion:** Start with TypeScript for hackathon velocity.

## Smart Contracts
**Decision: Solidity + Foundry**

Why Foundry:
- Very fast test/dev loop
- Excellent scripting/deploy workflows
- Easy event-driven testing and fuzzing

Alternative: Hardhat
- Great plugin ecosystem, heavier DX for rapid protocol iteration

**Conclusion:** Foundry for contracts, optional Hardhat only if specific plugin needed.

---

## 3) Networks / Testnets

Primary testnet target (recommended):
- **Base Sepolia** or **Ethereum Sepolia**

Selection criteria:
- Stable faucet access
- Good RPC availability
- Sponsor alignment if applicable

**Conclusion (default): Base Sepolia** unless sponsor track requires another.

---

## 4) Core Libraries

## Required Utilities SoulVault Wraps/Uses
- **EVM RPC provider** (read/write contract state + events)
- **IPFS upload/download adapter** (gateway/pinning API; local IPFS node optional)
- **Local secure key store** (store agent private key + unwrapped epoch keys)
- **Archive utilities** (`tar`/`gzip`) for deterministic bundles
- **Hashing/KDF utilities** (SHA-256, HKDF)
- **Process/system utils** for bootstrap/install orchestration

Note: each agent does **not** need to run a full IPFS daemon. MVP can use managed pinning/gateway clients. Running a local IPFS node is optional for self-hosted mode.

## CLI / App
- `typescript`
- `commander` (CLI commands)
- `ink` (TUI) or `blessed` (fallback)
- `ethers` (contracts/events/signing)
- `zod` (runtime schema validation)
- `pino` (structured logging)

## Crypto
- `libsodium-wrappers` (XChaCha20-Poly1305)
- Node `crypto` (SHA-256/HKDF helpers)

## IPFS
- `helia` or Pinata/Web3Storage SDK (choose one MVP provider)

## Contract Dev
- Foundry (`forge`, `cast`, `anvil`)

---

## 5) Chainlink Integration Scope

MVP+ integration:
- **Chainlink Automation** for scheduled checkpoint/revalidation triggers

Out of MVP:
- CCIP (cross-chain messaging)
- complex oracle-driven policy engines

---

## 6) OpenClaw Integration

Deliverable:
- `skills/soulvault/` skill wrapping CLI

Expected skill operations:
- swarm list/use
- join request/approve
- backup push / restore pull
- event watch / status

---

## 7) Packaging / Release

- CLI packaged as npm binary (`soulvault`)
- Optional Docker image for reproducible VPS bootstrap
- Bootstrap script shipped in repo/release with checksums/signatures

---

## 8) WireGuard / Relay Positioning

WireGuard itself does **not** require your proprietary relay by default, but NAT traversal patterns often benefit from:
- public coordination server
- optional relay for unreachable peers

Product options:
1. **Open-source self-hosted mode** (users run their own relay/control-plane)
2. **Managed relay service** (your hosted convenience layer)

Monetization model (if desired):
- Open-source protocol + self-host baseline
- Paid managed relay/control-plane: uptime SLA, monitoring, key rotation automation, audit logs, multi-region relays

Important:
- Keep protocol portable so users are never locked into managed infra.

---

## 9) Key Custody Policy (Finalized)

## MVP
- Owner escrow enabled: epoch key material recoverable via owner-wrapped escrow path.
- Recommended owner custody: hardware wallet (Ledger-class) for escrow key operations.

## Post-MVP
- Quorum escrow enabled: threshold-based recovery to avoid single owner-key dependency.
- Owner escrow may remain as emergency fallback depending on governance policy.

## Principle
- Contract governs authorization and references; key recovery/re-wrap happens offchain in authorized tooling.

---

## 10) Final Stack Summary

- **App:** TypeScript/Node CLI + TUI
- **Contracts:** Solidity + Foundry
- **Chain:** Base Sepolia (default)
- **Storage:** IPFS (encrypted payloads)
- **Crypto:** libsodium + HKDF
- **Automation:** Chainlink Automation (MVP+)
- **Agent UX:** OpenClaw skill wrapper over CLI
- **Networking (roadmap):** WireGuard + optional managed relay
