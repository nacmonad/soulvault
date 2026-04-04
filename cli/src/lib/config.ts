import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { resolveRepoRoot } from './paths.js';

const repoRoot = resolveRepoRoot();
dotenv.config({ path: path.join(repoRoot, '.env') });

const envSchema = z.object({
  SOULVAULT_SIGNER_MODE: z.enum(['mnemonic', 'private-key', 'ledger']).default('private-key'),
  SOULVAULT_MNEMONIC: z.string().optional(),
  SOULVAULT_MNEMONIC_PATH: z.string().default("m/44'/60'/0'/0/0"),
  SOULVAULT_PRIVATE_KEY: z.string().optional(),
  SOULVAULT_LEDGER_DERIVATION_PATH: z.string().default("m/44'/60'/0'/0/0"),
  SOULVAULT_RPC_URL: z.string().url().default('https://evmrpc-testnet.0g.ai'),
  SOULVAULT_CHAIN_ID: z.coerce.number().default(16602),
  SOULVAULT_ETH_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_ENS_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_ENS_CHAIN_ID: z.coerce.number().default(11155111),
  SOULVAULT_0G_STORAGE_URL: z.string().optional(),
  SOULVAULT_0G_INDEXER_URL: z.string().url().default('https://indexer-storage-testnet-turbo.0g.ai'),
  SOULVAULT_0G_AUTH_TOKEN: z.string().optional(),
  SOULVAULT_ERC8004_REGISTRY_ADDRESS: z.string().optional(),
  SOULVAULT_DEFAULT_SWARM_ADDRESS: z.string().optional(),
  SOULVAULT_DEFAULT_HARNESS: z.string().default('openclaw'),
  SOULVAULT_DEFAULT_BACKUP_COMMAND: z.string().optional(),
  SOULVAULT_TEST_K_EPOCH: z.string().default('0000000000000000000000000000000000000000000000000000000000000001')
});

export type SoulVaultEnv = z.infer<typeof envSchema>;

export function loadEnv(): SoulVaultEnv {
  return envSchema.parse(process.env);
}
