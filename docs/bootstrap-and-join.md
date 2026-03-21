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
1. Node reads latest encrypted CID pointers from contract
2. Node fetches encrypted bundle + encrypted manifest from IPFS
3. Node obtains decrypt capability (owner approval/signature workflow)
4. Node decrypts locally and verifies hashes
5. Node writes markdown files into workspace
6. Node starts OpenClaw runtime

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
