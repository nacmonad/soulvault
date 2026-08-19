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

## Environment configuration
Copy the project-root `.env.example` to `.env` and populate it before using the CLI.

The CLI is designed to support signer abstraction from the beginning:
- `SOULVAULT_SIGNER_MODE=mnemonic`
- `SOULVAULT_SIGNER_MODE=private-key`
- `SOULVAULT_SIGNER_MODE=ledger`

For MVP, mnemonic/private-key modes are expected first, with ledger mode reserved for later implementation.

## Local state layout
The scaffold keeps non-secret CLI state in `~/.soulvault/`:
- `~/.soulvault/config.json` — active defaults / address / harness / network
- `~/.soulvault/agent.json` — local agent profile
- `~/.soulvault/keys/` — future keystore + epoch key material

The project `.env` remains the MVP/dev bootstrap path for signer secrets. Longer term, the hot wallet should move to an encrypted keystore under `~/.soulvault/keys/`.

## Testing key
The scaffold also supports `SOULVAULT_TEST_K_EPOCH` so we can exercise `agent create`, `backup push`, and `restore pull` before full swarm epoch distribution is wired.
