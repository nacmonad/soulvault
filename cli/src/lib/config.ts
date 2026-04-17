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
  /** When `ledger` mode: if true, Ledger prompts to export/confirm the address on-device during connect (default is silent export). */
  SOULVAULT_LEDGER_CONFIRM_ADDRESS: z.preprocess(
    (v) => v === '1' || String(v ?? '').toLowerCase() === 'true',
    z.boolean(),
  ).default(false),
  SOULVAULT_RPC_URL: z.string().url().default('https://evmrpc-testnet.0g.ai'),
  SOULVAULT_CHAIN_ID: z.coerce.number().default(16602),
  SOULVAULT_ETH_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_ENS_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_ENS_CHAIN_ID: z.coerce.number().default(11155111),
  SOULVAULT_ENS_REGISTRY_ADDRESS: z.string().default('0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'),
  SOULVAULT_ENS_BASE_REGISTRAR_ADDRESS: z.string().default('0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85'),
  SOULVAULT_ENS_CONTROLLER_ADDRESS: z.string().default('0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968'),
  SOULVAULT_ENS_PUBLIC_RESOLVER_ADDRESS: z.string().default('0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5'),
  SOULVAULT_ENS_UNIVERSAL_RESOLVER_ADDRESS: z.string().default('0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'),
  SOULVAULT_0G_STORAGE_URL: z.string().optional(),
  SOULVAULT_0G_INDEXER_URL: z.string().url().default('https://indexer-storage-testnet-turbo.0g.ai'),
  SOULVAULT_0G_AUTH_TOKEN: z.string().optional(),
  SOULVAULT_ERC8004_REGISTRY_ADDRESS: z.string().optional(),
  SOULVAULT_DEFAULT_SWARM_ADDRESS: z.string().optional(),
  SOULVAULT_DEFAULT_HARNESS: z.string().default('openclaw'),
  SOULVAULT_DEFAULT_BACKUP_COMMAND: z.string().optional(),
  SOULVAULT_TEST_K_EPOCH: z.string().default('0000000000000000000000000000000000000000000000000000000000000001'),
  SOULVAULT_PROFILE: z.string().default('default'),
  SOULVAULT_WORKSPACE: z.string().optional(),
  /** Comma-separated ENS names (root org), e.g. `soulvault.eth`. Used by `soulvault sync` and optional ledger auto-sync. */
  SOULVAULT_SYNC_ORGANIZATION_ENS: z.string().optional(),
  /** Comma-separated swarm ENS names, e.g. `ops.soulvault.eth`. Parent org is inferred and must be owned by the wallet. */
  SOULVAULT_SYNC_SWARM_ENS: z.string().optional(),
  /** When `1`/`true` and signer mode is `ledger`, run ENS/registry sync after the device address is resolved (e.g. via `describeSigner`). */
  SOULVAULT_LEDGER_AUTO_SYNC: z.preprocess(
    (v) => v === '1' || String(v ?? '').toLowerCase() === 'true',
    z.boolean(),
  ).default(false),
  /**
   * Default clear-sign mode for Ledger transaction signing. Per-call `{ clearSign }`
   * option overrides this. See `docs/clear-signing-spec.md` §2.
   *   - strict-clear-sign: fail if CAL context empty for the selector
   *   - clear-sign-preferred: use CAL when available, fall back to generic signing
   *   - blind-only: skip CAL entirely (legacy; use for known-unsupported selectors)
   */
  SOULVAULT_LEDGER_CLEAR_SIGN_MODE: z
    .enum(['strict-clear-sign', 'clear-sign-preferred', 'blind-only'])
    .default('clear-sign-preferred'),
});

export type SoulVaultEnv = z.infer<typeof envSchema>;

export function loadEnv(): SoulVaultEnv {
  return envSchema.parse(process.env);
}
