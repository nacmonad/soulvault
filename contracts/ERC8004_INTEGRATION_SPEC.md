# ERC-8004 Integration Spec for SoulVault

## Important distinction
There should **not** be a custom `ISoulVaultMember.sol` contract for agent identity in MVP.

Why:
- **member** is a SoulVault swarm role
- **agent identity** belongs to ERC-8004

So the cleaner split is:
- `ISoulVaultSwarm.sol` = SoulVault swarm coordination contract
- `IERC8004AgentRegistryAdapter.sol` = SoulVault-facing integration surface for ERC-8004 identity registration

---

## Where ERC-8004 fits
SoulVault uses ERC-8004 for:
- public agent identity
- public metadata
- harness metadata
- public service endpoints
- base64 `agentURI`

SoulVault does **not** use ERC-8004 for:
- swarm membership authority
- epoch rotation
- backup file mappings
- historical key grants
- encrypted messaging

---

## Why an adapter interface exists
ERC-8004 is still draft-shaped and implementations may vary.

SoulVault only needs a minimal integration surface for the CLI:
- register agent
- update `agentURI`
- optionally set metadata fields
- resolve `agentURI`
- resolve `agentWallet`

That is why this repo now includes:
- `IERC8004AgentRegistryAdapter.sol`

This should be treated as the **SoulVault integration contract surface**, not the final normative ERC-8004 ABI.

---

## Recommended future upgrade path
When the exact ERC-8004 implementation ABI is locked:
1. replace or supplement the adapter interface with the canonical interface
2. keep the SoulVault CLI bound to a small internal adapter layer
3. avoid spreading draft-specific ABI assumptions across the codebase
