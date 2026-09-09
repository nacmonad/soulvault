/**
 * ENS-derived discovery for the dashboard state summaries.
 *
 * The org's ENS name is the coordination point: `soulvault.treasuries` (JSON)
 * enumerates treasuries with a per-chain ENSIP-11 slot, and `soulvault.swarms`
 * (CBOR data-URI) enumerates swarm labels — each swarm subdomain carries its
 * contract address (coinType-60 addr) and deployment chain
 * (`soulvault.chainId` text). Read-only; this is the web3-native replacement
 * for env/file deployment lists in the UI (ticket 012 extends it to event
 * bootstrap with deploy blocks).
 */
import { getAddress, type Address, type PublicClient } from "viem";

import { publicClientForChainId } from "@/lib/chains";
import {
  readEnsAddress,
  readEnsText,
  readOrgSwarmsList,
  readOrgTreasuries,
  type OrgTreasuryEntry,
} from "@/lib/ens-writes";

export type OrgSwarmEntry = {
  label: string;
  ensName: string;
  /** Swarm contract address from the subdomain's coinType-60 addr record. */
  address: Address | null;
  /** Deployment chain from the `soulvault.chainId` text record. */
  chainId: number | null;
};

export async function readOrgSwarms(orgEnsName: string): Promise<OrgSwarmEntry[]> {
  const labels = await readOrgSwarmsList(orgEnsName);
  return Promise.all(
    labels.map(async (label): Promise<OrgSwarmEntry> => {
      const ensName = `${label}.${orgEnsName}`;
      const [address, chainIdRaw] = await Promise.all([
        readEnsAddress(ensName).catch(() => null),
        readEnsText(ensName, "soulvault.chainId").catch(() => null),
      ]);
      const chainId = chainIdRaw && /^\d+$/.test(chainIdRaw) ? Number(chainIdRaw) : null;
      return { label, ensName, address, chainId };
    }),
  );
}

/**
 * Balances for published treasuries, each read on its own chain's client
 * (public registry RPC for non-Sepolia; operator override for Sepolia).
 * Unreachable chains are skipped — balance is decorative in the summary.
 */
export async function readTreasuryBalances(
  entries: OrgTreasuryEntry[],
): Promise<Record<string, bigint>> {
  const balances: Record<string, bigint> = {};
  await Promise.all(
    entries.map(async (entry) => {
      const client = publicClientForChainId(entry.chainId);
      if (!client) return;
      try {
        balances[entry.address.toLowerCase()] = await client.getBalance({ address: entry.address });
      } catch {
        // skip entries whose chain we can't reach
      }
    }),
  );
  return balances;
}

export type { OrgTreasuryEntry };
