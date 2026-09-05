import { decodeEventLog, isAddressEqual, type Address, type Hex, type Log } from "viem";
import { SOULVAULT_EVENT_ABIS } from "./abis";
import {
  createSoulVaultPublicClient,
  type SoulVaultClientConfig,
} from "./client";
import type { SoulVaultContractKind, SoulVaultDeployment } from "./types";

export type { SoulVaultContractKind, SoulVaultDeployment };
export {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig as getBrowserSoulVaultActivityConfig,
  parseSoulVaultClientConfig as parseSoulVaultActivityConfig,
  type SoulVaultClientConfig,
} from "./client";

export type SoulVaultContractKindLegacy = SoulVaultContractKind;
export type SoulVaultActivity = {
  contract: Address; contractKind: SoulVaultContractKind; contractLabel?: string;
  eventName: string; args: Record<string, unknown>; blockNumber: bigint;
  logIndex: number; transactionHash: Hex;
  relationship: "initiated" | "referenced" | "initiated-and-referenced";
};

function containsAddress(value: unknown, wallet: Address): boolean {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return isAddressEqual(value as Address, wallet);
  if (Array.isArray(value)) return value.some((v) => containsAddress(v, wallet));
  if (value && typeof value === "object") return Object.values(value).some((v) => containsAddress(v, wallet));
  return false;
}

export async function loadSoulVaultActivity(wallet: Address, config: SoulVaultClientConfig): Promise<SoulVaultActivity[]> {
  const client = createSoulVaultPublicClient(config);
  const deployments: SoulVaultDeployment[] = config.deployments;
  const decoded = (await Promise.all(deployments.map(async (deployment) => {
    const logs = await client.getLogs({ address: deployment.address, fromBlock: deployment.fromBlock, toBlock: "latest" });
    return logs.flatMap((log) => decodeKnownLog(log, deployment));
  }))).flat();
  const senders = new Map<Hex, Address>();
  await Promise.all([...new Set(decoded.map(({ log }) => log.transactionHash).filter(Boolean))].map(async (hash) => {
    const tx = await client.getTransaction({ hash: hash as Hex });
    senders.set(hash as Hex, tx.from);
  }));
  return decoded.flatMap(({ log, deployment, eventName, args }) => {
    if (!log.transactionHash || log.blockNumber == null) return [];
    const sender = senders.get(log.transactionHash);
    const initiated = !!sender && isAddressEqual(sender, wallet);
    const referenced = containsAddress(args, wallet);
    if (!initiated && !referenced) return [];
    return [{ contract: deployment.address, contractKind: deployment.kind, contractLabel: deployment.label, eventName, args, blockNumber: log.blockNumber, logIndex: log.logIndex ?? 0, transactionHash: log.transactionHash, relationship: initiated && referenced ? "initiated-and-referenced" as const : initiated ? "initiated" as const : "referenced" as const }];
  }).sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);
}

function decodeKnownLog(log: Log, deployment: SoulVaultDeployment) {
  try {
    const decoded = decodeEventLog({ abi: SOULVAULT_EVENT_ABIS[deployment.kind], data: log.data, topics: log.topics });
    if (decoded.eventName == null) return [];
    return [{ log, deployment, eventName: decoded.eventName, args: (decoded.args ?? {}) as Record<string, unknown> }];
  } catch { return []; }
}
