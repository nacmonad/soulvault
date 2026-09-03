# Brand Context

## Brand
- **Name**: SoulVault
- **Category**: Agent Coordination & Continuity
- **Description**: Encrypted continuity and coordination for agent swarms
- **Stage**: Pre-launch
- **Website**: N/A (in development)

## Audience
- **Primary Audience**: 
  - Autonomous agent swarms & their operators (core existing use case)
  - Professionals (lawyers, doctors, accountants, researchers) collaborating with agents over sensitive docs
  - Teams managing confidential workflows with mixed human + AI participants

- **Key Problems**: 
  - Agent sessions are ephemeral; swarms need persistent encrypted continuity (backup/restore/transfer)
  - Shared state requires trust boundaries and membership governance across autonomous agents
  - Agent skills and memory systems must survive across deployments
  - Sensitive documents leak during ordinary transport (email, Slack, storage)
  - Need fine-grained per-person/agent access without distributing plaintext
  - Same document must render different views to different authorized parties

- **Their Language**: "ephemeral sessions", "swarm coordination", "encrypted continuity", "epoch rotation", "membership governance", "backup & restore", "safe to email", "selective disclosure", "revocation", "wallet-authenticated access", "READ vs USE"

## Positioning

### Foundation (Existing Core)
- **Agent swarm continuity & coordination**: Encrypted backup/restore, membership governance, epoch rotation, encrypted messaging
- **Reusable cryptographic layer**: secp256k1 ECDH + AES-256-GCM (same primitives for all uses)
- **Isomorphic architecture**: Protocol logic runs in browsers and Node.js (no platform-specific crypto)

### Extension (Product A)
- **Wallet-based selective disclosure**: Same cryptographic foundation extended to confidential document collaboration
  - Document redaction happens locally (via presidio-web PII detection)
  - Redacted artifact is "safe to leak" (email, forward, share openly)
  - Only authorized wallets can reveal specific fields they're permitted to see
  - Same document renders different views to different authorized parties
  - Agents and humans share the same authorization model (wallet-scoped)
  - Sensitive data can be used by agents in a TEE without ever disclosing it (USE without READ)

- **Differentiation**: 
  - Dual-lane architecture (onchain coordination on 0G + Sepolia, offchain encryption)
  - Privacy-by-architecture: sensitive data never in plaintext during transport
  - Event-driven protocol (contracts emit events driving state changes)
  - Multi-tenant by default (wallet-native identity, no server DB)
  - Integrated treasury + fund request lifecycle for agent resource allocation
  - READ vs USE distinction (reveal plaintext OR compute privately over it)
  - One authorization model for both agent swarms AND document collaboration

- **Competitors**: TBD — market is nascent; adjacent projects in crypto confidentiality + document collaboration + agent continuity being researched

- **Market Position**: Pioneer/niche (establishing a new category: encrypted agent coordination + confidential collaboration with selective disclosure)

## Brand Personality
- **Personality Words**: Accessible, authoritative, precise, pioneering, trustworthy
- **Tone**: Formal + professional (enterprise-grade, serious intent)
- **Voice Admires**: None in particular; forge our own path

## Values & Mission
- **Core Values**:
  - **Privacy + Encryption** — user control, end-to-end security, no central authority
  - **Simplicity** — hide complexity, make the hard easy, clear mental models
- **Mission**: Enable agent swarms (autonomous and human-managed) to coordinate reliably, securely, and at scale without sacrificing privacy or decentralization.

## Goals

### Immediate (ETHOnline 2026 hackathon)
- Build working demo of wallet-authenticated confidential document collaboration (Product A)
- Prototype: redact → email safely → rehydrate via wallet → view permitted fields
- Show READ vs USE distinction (agent can compute on data without seeing it)
- Integrate presidio-web + 0G Storage + wallet auth + optional World/Ledger

### Primary Goal (12 months)
- **Agent swarm market**: Get early adopters using SoulVault for real swarm continuity & coordination (backup/restore/transfer of skills & memory)
- **Document collaboration market**: Establish SoulVault as the standard for confidential collaboration with selective disclosure
  - Professionals/teams actively redacting & sharing sensitive docs
  - Build trust in security model (legal, healthcare, research use cases)
  - Developer integration (APIs for agent backup, document redaction, rehydration, policy)
  - Market awareness (privacy-focused positioning; appeal to both crypto natives and professionals)

### Key Metrics
- **Swarm continuity**: Active swarms using backup/restore, recurring epochs rotated, member continuity
- **Document collaboration**: Confidential documents processed, rehydration success rate, time-to-revocation
- **Developer adoption**: CLI + API users, integrations, SDK usage
- **Market traction**: Professional/enterprise pilot programs, hackathon prize placement, sponsor alignment
- **Brand awareness**: Mentions across agent coordination + privacy + document collaboration spaces

## Critical Context from Monetization Plan

### Foundation: Existing SoulVault (Agent Swarm Continuity)
- Encrypted backup/restore of agent state, skills, memory across ephemeral sessions
- Membership governance, epoch rotation, encrypted messaging
- Secp256k1 ECDH + AES-256-GCM cryptographic primitives
- Treasury + fund request flows for agent resource allocation
- This is the **existing, tested core** that everything builds on

### Product A: Confidential Collaboration (Extension of Core)
- **Primary use case**: Make documents "safe to leak" by redacting sensitive fields locally and selectively rehydrating via wallet authorization
- **Built on**: Same cryptographic layer (secp256k1 ECDH, AES-256-GCM) and authorization model (wallet-scoped)
- **Architecture**: 
  - `presidio-web` (local PII detection) → redacted artifact + encrypted hydration bundle
  - Encrypted hydration data stored on 0G (never plaintext during transport)
  - Smart contract governs authorization (no PII on-chain, only commitments/nonces)
  - Humans authenticate via wallet + optional World proof + optional Ledger signing
  - Agents use existing SoulVault secp256k1 identity
  - TEE optional for private computation over sensitive fields (USE without READ)

- **Hackathon angle (ETHOnline 2026)**:
  - 0G (storage + EVM + TEE)
  - World (proof-of-human for high-risk disclosures)
  - Ledger (clear-signing for human-readable authorization decisions)

> **Update:** 0G is no longer a sponsor of ETHOnline 2026 — the 0G line above is
> retired. The current target set (Hedera x402 payments, Ledger grants, Chainlink
> CRE confidential compute) and the full post-0G design live in
> `docs/redaction-hydration-spec.md`.
  - presidio-web (credible local redaction engine)
  - **Reuses existing SoulVault membership/authorization primitives**

### Product B: Presidio Private (Standalone SaaS)
- **Separate** commercial product: confidential semantic PII analysis via Venice E2EE + DIEM + x402
- **Not required for the hackathon submission**
- Can integrate with SoulVault later as optional semantic-analysis provider

### Key Brand Messaging Takeaways
- Do NOT claim "blockchain makes it GDPR/HIPAA compliant" (avoid compliance overclaiming)
- DO emphasize: "privacy-preserving architecture designed around data minimization, selective disclosure, encryption, revocation"
- Safe-to-share documents are immediately understandable to non-crypto users
- Wallet-native (no signup) removes friction and aligns with user intent
- **Human + agent symmetry across both swarm coordination AND document collaboration** is a core strength
- Reusing the same cryptographic foundation for multiple use cases (agent continuity + confidential docs) is an architectural elegance worth highlighting
