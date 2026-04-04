# Contributing to SoulVault

SoulVault is an open-source, event-driven coordination and continuity layer for agent swarms. Contributions are welcome.

## Getting started

### Prerequisites
- Node.js >= 18
- pnpm (`npm install -g pnpm`)
- A funded wallet on **0G Galileo** (chain ID `16602`) for ops-lane transactions
- A funded wallet on **Sepolia** (chain ID `11155111`) for ENS/identity transactions
- Optional: Foundry (`forge`, `cast`) for contract development

### Setup
```bash
git clone https://github.com/<org>/soulvault.git
cd soulvault
pnpm install
cp .env.example .env   # fill in your keys and RPC endpoints
```

### Running the CLI
```bash
pnpm exec tsx cli/src/index.ts <command>
# or alias it:
alias soulvault="pnpm exec tsx cli/src/index.ts"
```

### Running tests
```bash
pnpm test              # vitest unit tests
pnpm test -- --run     # single run (no watch)
```

## Repository layout

```
contracts/       Solidity interfaces, specs, and protocol docs
cli/src/         TypeScript CLI — commands + business logic
  commands/      Commander.js command handlers
  lib/           Core libraries (crypto, storage, contract, state)
docs/            Architecture, protocol, glossary, roadmap
stories/         Narrative demo workflows (runnable)
skills/          Agent skill package (SKILL.md + references)
examples/        Standalone 0G SDK usage examples
```

## Two-lane architecture

SoulVault operates across two EVM chains:

| Lane | Chain | Purpose |
|------|-------|---------|
| **Ops** | 0G Galileo | Swarm contract, membership, epochs, backups, messages |
| **Identity** | Sepolia | ENS naming, ERC-8004 agent identity |

Both lanes share the same signer wallet. The CLI resolves which RPC/chain to use based on the command.

## How to contribute

### Reporting issues
Open a GitHub issue with:
- What you expected vs. what happened
- CLI command and output (redact private keys)
- `.env` config (redact secrets; keep chain IDs and RPC hosts)

### Submitting changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Add or update tests if applicable
5. Run `pnpm test` and ensure all tests pass
6. Submit a pull request against `main`

### PR conventions
- Keep PRs focused — one feature or fix per PR
- Title format: `<type>: <short description>` (e.g., `feat: add msg post --ttl flag`, `fix: epoch key store race condition`)
- Include a summary section explaining **what** and **why**
- Reference related issues with `Closes #N` or `Relates to #N`

### Commit messages
- Use imperative mood: "Add feature" not "Added feature"
- First line under 72 characters
- Body optional, but helpful for non-obvious changes

## Code conventions

### TypeScript
- Strict mode (`strict: true` in tsconfig)
- Use `viem` for contract interactions (preferred over raw ethers for new code)
- Use `zod` schemas for any external input validation (env, CLI args, contract return data)
- Keep command handlers thin — business logic lives in `cli/src/lib/`

### Contract interfaces
- Solidity interfaces live in `contracts/` alongside their spec docs
- Any contract method change must update `contracts/ISoulVaultSwarm.sol` and `contracts/SWARM_CONTRACT_SPEC.md`
- Update `skills/soulvault/references/events.md` when adding/changing events

### Documentation
- Story files (`stories/storyNN.md`) should be runnable copy-paste walkthroughs
- Reference docs in `skills/soulvault/references/` are the agent-facing source of truth
- Keep `README.md` high-level; put details in docs/ or references/

## Cryptography notes

SoulVault uses real cryptographic primitives. If your change touches encryption:
- **K_epoch** wrapping uses `secp256k1-ecdh-aes-256-gcm` — do not substitute without updating the full pipeline
- **Backup encryption** uses AES-256-GCM with K_epoch — AAD and nonce must be unique per operation
- **DM encryption** uses ephemeral ECDH — the ephemeral keypair must be fresh per message
- Never log or persist plaintext keys outside of `~/.soulvault/keys/`
- Never commit `.env` files or private keys

## Adding a new CLI command

1. Create the command handler in `cli/src/commands/<entity>.ts`
2. Wire it into the Commander program in `cli/src/index.ts`
3. Add business logic in `cli/src/lib/` (keep the command handler thin)
4. Update `skills/soulvault/references/commands.md`
5. Add a story in `stories/` if the command introduces a new workflow
6. Update `CLAUDE.md` if the command changes how agents should interact with the repo

## Adding a new contract event

1. Add the event signature to `contracts/ISoulVaultSwarm.sol`
2. Document it in `contracts/SWARM_CONTRACT_SPEC.md`
3. Add agent response behavior in `skills/soulvault/references/events.md`
4. Update the ABI fragment in `cli/src/lib/swarm-contract.ts`
5. If the event needs a CLI watcher response, update `cli/src/lib/backup-respond.ts` or create a new responder

## License

See [LICENSE](./LICENSE) for details.
