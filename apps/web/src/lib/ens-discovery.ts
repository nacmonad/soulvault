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
import { contractScanStartBlock } from "@/lib/onchain/scan-start";
import type { SoulVaultDeployment } from "@/lib/onchain/types";
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

/**
 * The org's published swarms and treasuries as watcher event sources — this is
 * the "which contracts to listen to" half of ENS-derived discovery (the org's
 * records are the operative info, not build-time env). When `watcherChainId`
 * is given, entries on other chains are skipped (one watcher per chain today;
 * multi-chain watchers are the extension point).
 */
export async function resolveOrgEventSources(
  orgEnsName: string,
  options?: { watcherChainId?: number },
): Promise<SoulVaultDeployment[]> {
  const watcherChainId = options?.watcherChainId;
  const onWatcherChain = (chainId: number) => watcherChainId === undefined || chainId === watcherChainId;
  // Failures propagate — a transient ENS read error must not masquerade as
  // "org has no contracts" (that used to silently drop the swarm source from
  // event discovery while the page's own discovery still listed it).
  const [treasuries, swarms] = await Promise.all([readOrgTreasuries(orgEnsName), readOrgSwarms(orgEnsName)]);
  const sources = await Promise.all([
    ...treasuries
      .filter((entry) => onWatcherChain(entry.chainId))
      .map(async (entry): Promise<SoulVaultDeployment> => ({
        address: getAddress(entry.address),
        kind: "treasury" as const,
        chainId: entry.chainId,
        fromBlock: await contractScanStartBlock({ address: getAddress(entry.address), chainId: entry.chainId }),
        label: entry.label ?? `${orgEnsName} treasury`,
      })),
    ...swarms
      .map(async (entry): Promise<SoulVaultDeployment | null> => {
        if (entry.address === null || entry.chainId === null) {
          console.warn(
            `[ens-discovery] swarm "${entry.label}" is listed on ${orgEnsName} but its addr/soulvault.chainId reads failed — excluded from event discovery`,
          );
          return null;
        }
        if (!onWatcherChain(entry.chainId)) return null;
        return {
          address: getAddress(entry.address),
          kind: "swarm" as const,
          chainId: entry.chainId,
          fromBlock: await contractScanStartBlock({ address: getAddress(entry.address), chainId: entry.chainId }),
          label: entry.label,
        };
      }),
  ]);
  return sources.filter((source): source is SoulVaultDeployment => source !== null);
}
