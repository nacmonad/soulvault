/**
 * ERC-8004 identity registry event-source discovery for the events provider.
 *
 * The identity registry is public protocol infrastructure on the identity lane
 * (Sepolia). It is announced on the protocol root name via the
 * `erc8004.registry` text record when written; until then, a built-in Sepolia
 * constant (the canonical SoulVault identity registry, with its known deploy
 * block) keeps agent-identity events flowing with no configuration at all.
 */
import { getAddress, type Address } from "viem";

import { SEPOLIA_CHAIN_ID, publicClientForChainId } from "@/lib/chains";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { contractScanStartBlock } from "@/lib/onchain/scan-start";
import { resolveRootEnsName } from "@/lib/document-registry";
import { readEnsText } from "@/lib/ens-writes";
import type { SoulVaultDeployment } from "@/lib/onchain/types";

export const ERC8004_REGISTRY_TEXT_KEY = "erc8004.registry";

/** Canonical Sepolia identity registry (see apps/web/.env.example history). */
const DEFAULT_IDENTITY_REGISTRY = getAddress(
  "0xffb7d6e80e962f3a6c7fb29876c97c37f088a266",
);
const DEFAULT_IDENTITY_FROM_BLOCK = 10592315n;

/**
 * The identity registry as a watcher event source. The identity lane is
 * Sepolia-only today, so non-Sepolia watchers get no identity source.
 */
export async function resolveIdentityEventSource(input?: {
  chainId?: number;
}): Promise<SoulVaultDeployment | null> {
  const config = getBrowserSoulVaultClientConfig();
  const chainId = input?.chainId ?? config?.chainId ?? SEPOLIA_CHAIN_ID;
  if (chainId !== SEPOLIA_CHAIN_ID) return null;

  const rootEnsName = resolveRootEnsName();
  let address: Address | null = null;
  try {
    const client = publicClientForChainId(SEPOLIA_CHAIN_ID);
    const raw = client ? await readEnsText(rootEnsName, ERC8004_REGISTRY_TEXT_KEY) : null;
    if (raw && /^0x[0-9a-fA-F]{40}$/.test(raw)) address = getAddress(raw);
  } catch {
    // fall through to the built-in constant
  }

  if (!address) {
    return {
      address: DEFAULT_IDENTITY_REGISTRY,
      kind: "identity",
      fromBlock: DEFAULT_IDENTITY_FROM_BLOCK,
      label: "erc8004",
      chainId: SEPOLIA_CHAIN_ID,
    };
  }

  const fromBlock = await contractScanStartBlock({ address, chainId });
  return { address, kind: "identity", fromBlock, label: "erc8004", chainId };
}
