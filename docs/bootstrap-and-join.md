# Bootstrap + Join Flow

## First-Time Swarm Setup (Human)
1. Owner deploys swarm contract
2. Owner configures join policy = owner approval required
3. Owner starts `soulvault events watch --swarm <name>`

## First Agent Join (Special)
1. New node installs OpenClaw + SoulVault
2. Node generates local agent keypair
3. Node submits join request onchain
4. Owner reviews and approves via SoulVault CLI
5. Node receives approved status and can restore

## Restore Flow
1. Node reads latest encrypted pointers from contract (bundle/manifest + current epoch + keyBundle CID)
2. Node fetches wrapped-key bundle from IPFS and unwraps its own `K_epoch` entry locally
3. Node selects restore target in CLI:
   - shared swarm state
   - specific agent bundle (e.g., a particular soul/memory set)
4. Node fetches selected encrypted bundle + encrypted manifest from IPFS
5. Node decrypts locally with `K_epoch` and verifies hashes
6. Node writes markdown files into workspace
7. Node starts OpenClaw runtime
## Required Markdown Backup Set
- `SOUL.md`
- `USER.md`
- `MEMORY.md`
- `AGENTS.md`
- `HEARTBEAT.md`
- selected `memory/*.md`

## Safety Rules
- No plaintext markdown to IPFS
- No private keys in backup bundle
- Verify manifest and per-file hashes before restore
- Bootstrapped scripts must be hash-pinned/signed before execution
