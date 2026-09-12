import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { resolveRepoRoot } from './paths.js';
import { WorldIdentityConfig } from './world-identity.js';

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
  /**
   * Ops/admin lane. Currently defaults to Sepolia so swarm/treasury/ENS all run on one
   * chain during development; 0G Galileo (16602) is the production target — override
   * these two vars to move the ops lane back.
   */
  SOULVAULT_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_CHAIN_ID: z.coerce.number().default(11155111),
  SOULVAULT_ETH_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'), // identity lane (ENS)
  SOULVAULT_ENS_RPC_URL: z.string().url().default('https://ethereum-sepolia-rpc.publicnode.com'),
  SOULVAULT_ENS_CHAIN_ID: z.coerce.number().default(11155111),
  SOULVAULT_ENS_REGISTRY_ADDRESS: z.string().default('0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e'),
  SOULVAULT_ENS_BASE_REGISTRAR_ADDRESS: z.string().default('0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85'),
  SOULVAULT_ENS_CONTROLLER_ADDRESS: z.string().default('0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968'),
  SOULVAULT_ENS_PUBLIC_RESOLVER_ADDRESS: z.string().default('0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5'),
  SOULVAULT_ENS_UNIVERSAL_RESOLVER_ADDRESS: z.string().default('0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe'),
  /**
   * ENSv2 (Sepolia beta) switch. When enabled, all ENS reads/writes in `ens.ts` dispatch
   * to the ENSv2 hierarchical-registry contracts instead of the ENSv1 registry/resolver.
   * Kill switch for beta churn: flip to false to revert the whole ENS lane to v1.
   */
  SOULVAULT_ENSV2: z.preprocess(
    (v) => v === '1' || String(v ?? '').toLowerCase() === 'true',
    z.boolean(),
  ).default(false),
  /** ENSv2 RootRegistry (hierarchy walk starts here). Required when SOULVAULT_ENSV2=1. */
  SOULVAULT_ENSV2_ROOT_REGISTRY_ADDRESS: z.string().optional(),
  /** ENSv2 Universal Resolver V2 (offchain-capable resolution entry point). */
  SOULVAULT_ENSV2_UNIVERSAL_RESOLVER_ADDRESS: z.string().optional(),
  /** ENSv2 shared LabelStore (registry deploys share one label database). */
  SOULVAULT_ENSV2_LABEL_STORE_ADDRESS: z.string().optional(),
  /** Canonical UserRegistry implementation (deployed via VerifiableFactory as proxy). */
  SOULVAULT_ENSV2_USER_REGISTRY_IMPL_ADDRESS: z.string().optional(),
  /** VerifiableFactory — trust anchor for verifiable proxy deployments. */
  SOULVAULT_ENSV2_VERIFIABLE_FACTORY_ADDRESS: z.string().optional(),
  SOULVAULT_0G_STORAGE_URL: z.string().optional(),
  SOULVAULT_0G_INDEXER_URL: z.string().url().default('https://indexer-storage-testnet-turbo.0g.ai'),
  SOULVAULT_0G_AUTH_TOKEN: z.string().optional(),
  /** Payload storage backend for swarm messages: `0g` (default) or `file` (co-located demos/dev). */
  SOULVAULT_STORAGE_BACKEND: z.enum(['0g', 'file']).optional(),
  /** Directory for the `file` storage backend (default: `<repo>/.soulvault-storage`). */
  SOULVAULT_STORAGE_DIR: z.string().optional(),
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
  /**
   * Per-device-action timeout in ms (address confirm, transaction/message signing).
   * Each Ledger action gets its own fresh window — multi-tx flows like `swarm create`
   * are not sharing one budget. Blind-signing with on-device hash verification and
   * large deploy payloads need more than the old 60s default.
   */
  SOULVAULT_LEDGER_ACTION_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  /** World ID app_id from the Developer Portal (app_xxxxx). Enables the World identity layer when set. */
  WORLD_APP_ID: z.string().optional(),
  /** World ID 4.0 relying-party id from the Developer Portal (rp_xxxxx). */
  WORLD_RP_ID: z.string().optional(),
  /** RP signing key hex. Backend-only secret; never expose client-side or commit. */
  WORLD_RP_SIGNING_KEY: z.string().optional(),
  /** `staging` targets the simulator/sandbox, `production` the live World ID app. */
  WORLD_ENVIRONMENT: z.enum(['staging', 'production']).default('staging'),
});

export type SoulVaultEnv = z.infer<typeof envSchema>;

export function loadEnv(): SoulVaultEnv {
  return envSchema.parse(process.env);
}

/**
 * Resolve the World ID identity config from the environment.
 * Returns null when World integration is not configured (no app id / rp id),
 * so callers can degrade gracefully.
 */
export function loadWorldIdentityConfig(env?: SoulVaultEnv): WorldIdentityConfig | null {
  const e = env ?? loadEnv();
  if (!e.WORLD_APP_ID || !e.WORLD_RP_ID || !e.WORLD_RP_SIGNING_KEY) {
    return null;
  }
  return WorldIdentityConfig.parse({
    appId: e.WORLD_APP_ID,
    rpId: e.WORLD_RP_ID,
    signingKeyHex: e.WORLD_RP_SIGNING_KEY,
    environment: e.WORLD_ENVIRONMENT,
  });
}
