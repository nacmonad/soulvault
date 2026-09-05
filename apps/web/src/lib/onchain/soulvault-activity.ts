import { createPublicClient, decodeEventLog, http, isAddressEqual, parseAbi, type Address, type Hex, type Log } from "viem";

export type SoulVaultContractKind = "swarm" | "treasury" | "identity";
export type SoulVaultDeployment = { address: Address; kind: SoulVaultContractKind; fromBlock: bigint; label?: string };
export type SoulVaultActivity = {
  contract: Address; contractKind: SoulVaultContractKind; contractLabel?: string;
  eventName: string; args: Record<string, unknown>; blockNumber: bigint;
  logIndex: number; transactionHash: Hex;
  relationship: "initiated" | "referenced" | "initiated-and-referenced";
};
export type SoulVaultActivityConfig = { rpcUrl: string; chainId: number; deployments: SoulVaultDeployment[] };

const ABIS = {
  swarm: parseAbi([
    "event JoinRequested(uint256 indexed requestId, address indexed requester, bytes pubkey, string pubkeyRef, string metadataRef)",
    "event JoinApproved(uint256 indexed requestId, address indexed requester, address indexed approver, uint64 epoch)",
    "event JoinRejected(uint256 indexed requestId, address indexed requester, address indexed rejector, string reason)",
    "event JoinCancelled(uint256 indexed requestId, address indexed requester)",
    "event MemberRemoved(address indexed member, address indexed by, uint64 epoch)",
    "event EpochRotated(uint64 indexed oldEpoch, uint64 indexed newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint64 membershipVersion)",
    "event MemberFileMappingUpdated(address indexed member, uint64 indexed epoch, string storageLocator, bytes32 merkleRoot, bytes32 publishTxHash, bytes32 manifestHash, address indexed by)",
    "event AgentMessagePosted(address indexed from, address indexed to, string topic, uint64 seq, uint64 epoch, string payloadRef, bytes32 payloadHash, uint64 ttl, uint64 timestamp)",
    "event AgentManifestUpdated(address indexed agent, string manifestRef, bytes32 manifestHash, uint64 timestamp)",
    "event BackupRequested(address indexed requestedBy, uint64 indexed epoch, string reason, string targetRef, uint64 deadline, uint64 timestamp)",
    "event HistoricalKeyBundleGranted(address indexed member, uint64 indexed epoch, string keyBundleRef, bytes32 keyBundleHash, address indexed by)",
    "event RekeyRequested(string trigger, uint64 membershipVersion)",
    "event Paused(address indexed by)", "event Unpaused(address indexed by)",
    "event TreasurySet(address indexed oldTreasury, address indexed newTreasury, address indexed by)",
    "event FundRequested(uint256 indexed requestId, address indexed requester, uint256 amount, string reason)",
    "event FundRequestApproved(uint256 indexed requestId, address indexed requester, address indexed treasury, uint256 amount)",
    "event FundRequestRejected(uint256 indexed requestId, address indexed requester, address indexed treasury, string reason)",
    "event FundRequestCancelled(uint256 indexed requestId, address indexed requester)",
  ]),
  treasury: parseAbi([
    "event FundsDeposited(address indexed from, uint256 amount)",
    "event FundsReleased(address indexed swarm, uint256 indexed requestId, address indexed recipient, uint256 amount)",
    "event FundRequestRejectedByTreasury(address indexed swarm, uint256 indexed requestId, string reason)",
    "event TreasuryWithdrawn(address indexed to, uint256 amount)",
  ]),
  identity: parseAbi([
    "event AgentRegistered(uint256 indexed agentId, address indexed agentWallet, string agentURI)",
    "event AgentURIUpdated(uint256 indexed agentId, address indexed agentWallet, string agentURI)",
    "event AgentMetadataSet(uint256 indexed agentId, string key, string value)",
  ]),
} as const;

export function parseSoulVaultActivityConfig(input: { rpcUrl?: string; chainId?: string; deployments?: string }): SoulVaultActivityConfig | null {
  if (!input.rpcUrl || !input.deployments) return null;
  const raw = JSON.parse(input.deployments) as Array<{ address: Address; kind: SoulVaultContractKind; fromBlock: string | number; label?: string }>;
  return { rpcUrl: input.rpcUrl, chainId: Number(input.chainId ?? "11155111"), deployments: raw.map((d) => ({ ...d, fromBlock: BigInt(d.fromBlock) })) };
}

export function getBrowserSoulVaultActivityConfig() {
  return parseSoulVaultActivityConfig({ rpcUrl: process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL, chainId: process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID, deployments: process.env.NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS });
}

function containsAddress(value: unknown, wallet: Address): boolean {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return isAddressEqual(value as Address, wallet);
  if (Array.isArray(value)) return value.some((v) => containsAddress(v, wallet));
  if (value && typeof value === "object") return Object.values(value).some((v) => containsAddress(v, wallet));
  return false;
}

export async function loadSoulVaultActivity(wallet: Address, config: SoulVaultActivityConfig): Promise<SoulVaultActivity[]> {
  const client = createPublicClient({ chain: { id: config.chainId, name: `SoulVault chain ${config.chainId}`, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [config.rpcUrl] } } }, transport: http(config.rpcUrl) });
  const decoded = (await Promise.all(config.deployments.map(async (deployment) => {
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
    const decoded = decodeEventLog({ abi: ABIS[deployment.kind], data: log.data, topics: log.topics });
    return [{ log, deployment, eventName: decoded.eventName, args: (decoded.args ?? {}) as Record<string, unknown> }];
  } catch { return []; }
}
