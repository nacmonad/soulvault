/**
 * Chain registry for the creation wizards. Sepolia is the default deployment
 * chain and the only ENS lane — ENS writes (registry, resolver, ENSIP-11
 * records) always target Sepolia regardless of where contracts deploy, so a
 * single namespace coordinates multi-chain treasuries and swarms.
 *
 * RPC endpoints are public defaults; the Sepolia URL defers to the operator's
 * settings override / build env wherever `getBrowserSoulVaultClientConfig()`
 * is used.
 */
import { createPublicClient, http, type PublicClient } from "viem";

import { createSoulVaultPublicClient, getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";

export type SoulVaultChain = {
  id: number;
  name: string;
  /** Short label for the wizard select. */
  label: string;
  rpcUrl: string;
  currency: { name: string; symbol: string; decimals: 18 };
  explorer: string;
};

export const SEPOLIA_CHAIN_ID = 11155111;

/** Chains offered in the wizards' "Deployment chain" select. Sepolia first. */
export const WIZARD_CHAINS: SoulVaultChain[] = [
  {
    id: 11155111,
    name: "Sepolia",
    label: "Sepolia (default)",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: "https://sepolia.etherscan.io",
  },
  {
    id: 84532,
    name: "Base Sepolia",
    label: "Base Sepolia",
    rpcUrl: "https://base-sepolia-rpc.publicnode.com",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: "https://sepolia.basescan.org",
  },
  {
    id: 421614,
    name: "Arbitrum Sepolia",
    label: "Arbitrum Sepolia",
    rpcUrl: "https://arbitrum-sepolia-rpc.publicnode.com",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: "https://sepolia.arbiscan.io",
  },
  {
    id: 11155420,
    name: "OP Sepolia",
    label: "OP Sepolia",
    rpcUrl: "https://optimism-sepolia-rpc.publicnode.com",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: "https://sepolia-optimism.etherscan.io",
  },
];

export function chainById(chainId: number): SoulVaultChain | undefined {
  return WIZARD_CHAINS.find((c) => c.id === chainId);
}

/**
 * A read/estimate client for the given chain. Sepolia respects the operator's
 * configured RPC (settings override / build env); other chains use the
 * registry's public endpoint. Returns `null` for unknown chains.
 */
export function publicClientForChainId(chainId: number): PublicClient | null {
  if (chainId === SEPOLIA_CHAIN_ID) {
    const config = getBrowserSoulVaultClientConfig();
    if (config) return createSoulVaultPublicClient(config);
  }
  const chain = chainById(chainId);
  if (!chain) return null;
  return createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.currency,
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
    transport: http(chain.rpcUrl),
  });
}
