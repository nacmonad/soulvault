# SoulVault Contracts

This folder contains implementation-facing contract specs and interfaces for SoulVault.

## Scope
- **Swarm contract**: SoulVault-native contract responsible for membership, epochs, historical key grants, per-member file mappings, messaging, and manifest references.
- **Agent contract**: **not implemented here as a custom SoulVault contract**. Agent identity uses **ERC-8004** directly.

## Files
- `ISoulVaultSwarm.sol` — Solidity interface / MVP contract surface for the swarm contract
- `IERC8004AgentRegistryAdapter.sol` — SoulVault-facing ERC-8004 integration surface for agent identity registration
- `SWARM_CONTRACT_SPEC.md` — prose spec for state, methods, roles, and event semantics
- `ERC8004_INTEGRATION_SPEC.md` — notes on how SoulVault integrates with ERC-8004 and why there is no `ISoulVaultMember.sol`
- `AGENT_IDENTITY_NOTES.md` — notes on how SoulVault uses ERC-8004 for the agent identity layer
