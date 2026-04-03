# Agent Identity Notes

SoulVault does **not** define a custom agent identity contract.

## Agent identity contract
Use **ERC-8004** directly.

## Model
- one ERC-8004 identity per agent
- `agentURI` is base64 `data:application/json;base64,...` in MVP
- custom SoulVault metadata may include:
  - `soulvault.swarmId`
  - `soulvault.swarmContract`
  - `soulvault.memberAddress`
  - `soulvault.role`
  - `soulvault.harness`
  - `soulvault.backupHarnessCommand`
  - `soulvault.publicManifestUri`
  - `soulvault.publicManifestHash`

## Responsibility split
- **ERC-8004** = public identity, discovery, trust metadata
- **SoulVault swarm contract** = private coordination, epochs, recovery references, file mappings, messaging

## CLI consequence
The SoulVault CLI must include agent-specific identity commands in addition to swarm commands.
