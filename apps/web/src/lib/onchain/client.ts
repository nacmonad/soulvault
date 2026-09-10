/**
 * viem client + config for the browser.
 *
 * Operative contract info (which contracts to listen to) comes from ENS
 * metadata — the org's records plus per-chain singletons announced on the
 * protocol root name — discovered at runtime. `NEXT_PUBLIC_ env vars carry
 * only transport (RPC endpoint, chain id). The legacy build-time deployments
 * JSON list still parses when present (legacy bootstrap), defaulting to [].
 */
import { createPublicClient, fallback, http, type Address, type PublicClient } from 'viem';
import { sepolia } from 'viem/chains';
import { getRpcUrlOverride, parseRpcUrlList } from '@/lib/rpc-settings';
import type { SoulVaultContractKind, SoulVaultDeployment } from './types';

export type SoulVaultClientConfig = {
  rpcUrl: string;
  chainId: number;
  deployments: SoulVaultDeployment[];
};

export const SOULVAULT_DEFAULT_CHAIN_ID = 11155111;

export function parseSoulVaultClientConfig(input: {
  rpcUrl?: string;
  chainId?: string;
  deployments?: string;
}): SoulVaultClientConfig | null {
  if (!input.rpcUrl) return null;
  // Legacy build-time deployments list: optional bootstrap, never required —
  // event sources are discovered from ENS at runtime instead. A missing,
  // empty, or malformed list parses to [].
  const deployments: SoulVaultDeployment[] = [];
  if (input.deployments) {
    try {
      const raw: unknown = JSON.parse(input.deployments);
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const row = item as { address?: Address; kind?: SoulVaultContractKind; fromBlock?: string | number; label?: string };
          if (!row.address || !row.kind || row.fromBlock === undefined) continue;
          deployments.push({ ...row, address: row.address, kind: row.kind, fromBlock: BigInt(row.fromBlock), label: row.label });
        }
      }
    } catch {
      // legacy list is best-effort
    }
  }
  return {
    rpcUrl: input.rpcUrl,
    chainId: Number(input.chainId ?? SOULVAULT_DEFAULT_CHAIN_ID),
    deployments,
  };
}

export function getBrowserSoulVaultClientConfig(): SoulVaultClientConfig | null {
  const envRpc = process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL;
  // Operator override (localStorage, /dashboard/settings) wins over build-time env.
  const rpcUrl = getRpcUrlOverride() ?? envRpc;
  return parseSoulVaultClientConfig({
    rpcUrl,
    chainId: process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID,
    deployments: process.env.NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS,
  });
}

/**
 * Build the public client. `rpcUrl` may be a comma-separated provider list:
 * one endpoint → plain http transport; several → viem's fallback transport
 * trying them in configured order (rank: false — no startup probing, first
 * configured provider stays primary). Per-endpoint retryCount is 0 so a 429
 * fails over immediately instead of hammering the rate-limited provider;
 * retry/backoff policy lives in the getLogs chunker and the watcher tick.
 */
export function createSoulVaultPublicClient(config: SoulVaultClientConfig): PublicClient {
  const urls = parseRpcUrlList(config.rpcUrl);
  const endpoints = urls.length > 0 ? urls : [config.rpcUrl];
  const transports = endpoints.map((url) => http(url, { retryCount: 0 }));
  return createPublicClient({
    chain: {
      id: config.chainId,
      name: `SoulVault chain ${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: endpoints } },
    },
    transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: false }),
  });
}

/**
 * Public client for viem's high-level ENS actions (getEnsName, getEnsAddress,
 * getEnsResolver, getEnsText). Same failover policy as
 * `createSoulVaultPublicClient`, but built on the real `sepolia` chain object —
 * those actions read the chain's ENS universal-resolver contract addresses,
 * which the synthetic chain above does not carry. Only valid while the
 * identity lane is Sepolia (callers already guard `config.chainId`).
 */
export function createSepoliaEnsClient(config: SoulVaultClientConfig): PublicClient {
  const urls = parseRpcUrlList(config.rpcUrl);
  const endpoints = urls.length > 0 ? urls : [config.rpcUrl];
  const transports = endpoints.map((url) => http(url, { retryCount: 0 }));
  return createPublicClient({
    chain: sepolia,
    transport: transports.length === 1 ? transports[0] : fallback(transports, { rank: false }),
  });
}
