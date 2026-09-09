/**
 * viem client + deployment config for the browser.
 *
 * Config shape mirrors what the dashboard already parses: NEXT_PUBLIC_ env vars
 * carrying the RPC endpoint, chain id, and a JSON deployment list. The document
 * contract lands on Sepolia alongside ENS / ERC-8004, so the default chain id
 * is Sepolia's.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
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
  if (!input.rpcUrl || !input.deployments) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(input.deployments);
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const deployments: SoulVaultDeployment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null;
    const row = item as { address?: Address; kind?: SoulVaultContractKind; fromBlock?: string | number; label?: string };
    if (!row.address || !row.kind || row.fromBlock === undefined) return null;
    deployments.push({ ...row, address: row.address, kind: row.kind, fromBlock: BigInt(row.fromBlock), label: row.label });
  }
  return {
    rpcUrl: input.rpcUrl,
    chainId: Number(input.chainId ?? SOULVAULT_DEFAULT_CHAIN_ID),
    deployments,
  };
}

export function getBrowserSoulVaultClientConfig(): SoulVaultClientConfig | null {
  return parseSoulVaultClientConfig({
    rpcUrl: process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL,
    chainId: process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID,
    deployments: process.env.NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS,
  });
}

export function createSoulVaultPublicClient(config: SoulVaultClientConfig): PublicClient {
  return createPublicClient({
    chain: {
      id: config.chainId,
      name: `SoulVault chain ${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [config.rpcUrl] } },
    },
    transport: http(config.rpcUrl),
  });
}
