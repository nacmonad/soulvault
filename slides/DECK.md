---
marp: true
theme: default
paginate: true
title: SoulVault
---

# SoulVault

## Encrypted Agent Continuity + Onchain Swarm Coordination

---

# Problem

- Agent memory and persona state are fragile across infra resets
- Trustless collaboration between multiple autonomous agents is hard
- Teams need secure restore plus auditable coordination

---

# Core Insight

- Keep state encrypted end-to-end
- Store ciphertext in 0G Storage
- Use swarm contracts as the approval and coordination layer

---

# Architecture

**Owner Wallet** ↔ **Swarm Contract** ↔ **SoulVault CLI** ↔ **0G Storage** ↔ **OpenClaw Nodes**

Ops lane:
- 0G Galileo for swarm contract events, membership, epochs, backups, and messaging

Identity lane:
- Sepolia for ENS naming and ERC-8004 public agent identity

---

# Security Model

- Human root of trust for first join
- Epoch content key model (`K_epoch`) with rotation on join/kick
- Wrapped key bundles in offchain encrypted storage
- No symmetric keys onchain
- Explicit per-member file mappings onchain:
  - storage locator
  - merkle root
  - publish tx hash
- Encrypted markdown bundles:
  - `SOUL`
  - `MEMORY`
  - `HEARTBEAT`
- No private keys in backups
- Hash verification at restore

---

# Demo Flow

1. Deploy swarm contract
2. Agent requests join
3. Owner approves
4. Agent restores encrypted state from 0G Storage
5. Agent boots with recovered identity

---

# Multi-Swarm + Event Watcher

- One contract = one swarm
- SoulVault can manage and switch many swarms
- Event-driven coordination
- Owner emits backup requests
- Agents watch events and respond automatically

---

# Quorum + Treasury Roadmap

- M-of-N admissions
- Safe-based USDC treasury policies
- Controlled auto-scale for new VPS agents

---

# Competitive Landscape

## What exists

- Agent coordination frameworks
- DAO / multisig governance
- Decentralized storage and encrypted backup tools

## What is missing

- End-to-end agent identity continuity for markdown memory/state
- Join governance plus encrypted restore in one lifecycle
- OpenClaw-native multi-swarm operations

## SoulVault contribution

- Encrypted continuity
- Onchain admissions
- Event-driven swarm messaging

---

# Why this matters

- Agent continuity
- Composable coordination primitive
- Verified swarm messaging via contract events
- Useful for autonomous research and dev swarms

---

# Ask / Next Steps

- Partner integrations
- Security review
- Production hardening
