# SoulVault Environment Variables

All variables are loaded from `.env` in the project root via `dotenv`.

---

## Signer Configuration

| Variable | Description | Example |
|----------|-------------|---------|
| `SOULVAULT_SIGNER_MODE` | Signer type: `private-key`, `mnemonic`, or `ledger` | `private-key` |
| `SOULVAULT_PRIVATE_KEY` | Hex private key (when mode=private-key) | `0xabc...` |
| `SOULVAULT_MNEMONIC` | BIP39 mnemonic phrase (when mode=mnemonic) | `word1 word2 ...` |
| `SOULVAULT_MNEMONIC_PATH` | HD derivation path (default: `m/44'/60'/0'/0/0`) | `m/44'/60'/0'/0/0` |

---

## 0G Galileo (SoulVault Operations Lane)

| Variable | Description | Example |
|----------|-------------|---------|
| `SOULVAULT_RPC_URL` | 0G Galileo RPC endpoint | `https://evmrpc-testnet.0g.ai` |
| `SOULVAULT_CHAIN_ID` | 0G chain ID | `16602` |

---

## Sepolia (ENS + Identity Lane)

| Variable | Description | Example |
|----------|-------------|---------|
| `SOULVAULT_ETH_RPC_URL` | Sepolia RPC endpoint | `https://ethereum-sepolia-rpc.publicnode.com` |
| `SOULVAULT_ENS_RPC_URL` | ENS-specific RPC (can be same as ETH) | `https://ethereum-sepolia-rpc.publicnode.com` |
| `SOULVAULT_ENS_CHAIN_ID` | Sepolia chain ID | `11155111` |

---

## ENS Contract Addresses (Sepolia)

| Variable | Description |
|----------|-------------|
| `SOULVAULT_ENS_REGISTRY_ADDRESS` | ENS Registry contract |
| `SOULVAULT_ENS_BASE_REGISTRAR_ADDRESS` | Base Registrar |
| `SOULVAULT_ENS_CONTROLLER_ADDRESS` | ETH Registrar Controller |
| `SOULVAULT_ENS_PUBLIC_RESOLVER_ADDRESS` | Public Resolver |
| `SOULVAULT_ENS_UNIVERSAL_RESOLVER_ADDRESS` | Universal Resolver |

---

## 0G Storage

| Variable | Description | Example |
|----------|-------------|---------|
| `SOULVAULT_0G_INDEXER_URL` | 0G Storage indexer endpoint | `https://indexer-storage-testnet-turbo.0g.ai` |
| `SOULVAULT_0G_STORAGE_URL` | Optional storage node URL | — |
| `SOULVAULT_0G_AUTH_TOKEN` | Optional auth token for 0G | — |

---

## ERC-8004 Identity

| Variable | Description |
|----------|-------------|
| `SOULVAULT_ERC8004_REGISTRY_ADDRESS` | ERC-8004 Agent Registry contract on Sepolia |

---

## Defaults & Runtime

| Variable | Description | Default |
|----------|-------------|---------|
| `SOULVAULT_DEFAULT_SWARM_ADDRESS` | Default swarm contract address | — |
| `SOULVAULT_DEFAULT_HARNESS` | Default harness type | `openclaw` |
| `SOULVAULT_DEFAULT_BACKUP_COMMAND` | Backup command for automated response | `openclaw backup create ...` |
| `SOULVAULT_WORKSPACE` | Workspace directory for backup responder | `process.cwd()` |
| `SOULVAULT_TEST_K_EPOCH` | Test/dev epoch key override | `0x...0001` |
