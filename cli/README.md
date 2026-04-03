# SoulVault CLI

This folder contains CLI command and workflow specs for SoulVault.

## Scope
The CLI now has two major surfaces:

1. **Swarm operations**
   - create/use/list swarms
   - join / approve / reject / remove
   - rotate epochs
   - restore / keygrant / watch events
   - publish per-member file mappings after backups

2. **Agent identity operations**
   - create/update ERC-8004 agent identity
   - embed harness metadata
   - manage base64 `agentURI` payloads
   - run harness-aware backups

## Files
- `COMMANDS.md` — full command tree and semantics
- `WORKFLOWS.md` — how commands combine into common operator/agent flows
