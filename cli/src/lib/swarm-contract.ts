import { Contract } from 'ethers';
import { getActiveSwarm, getSwarmProfile } from './swarm.js';
import { createProvider, createSigner } from './signer.js';
import { getAgentProfile } from './agent.js';

const SOULVAULT_SWARM_ABI = [
  'function owner() view returns (address)',
  'function currentEpoch() view returns (uint64)',
  'function membershipVersion() view returns (uint64)',
  'function memberCount() view returns (uint256)',
  'function getMember(address member) view returns ((bool active, bytes pubkey, uint64 joinedEpoch))',
  'function requestJoin(bytes pubkey, string pubkeyRef, string metadataRef) returns (uint256 requestId)',
  'function approveJoin(uint256 requestId)',
  'function rejectJoin(uint256 requestId, string reason)',
  'function rotateEpoch(uint64 newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint64 expectedMembershipVersion)',
  'function requestBackup(uint64 epoch, string reason, string targetRef, uint64 deadline)',
  'function updateMemberFileMapping(address member, string storageLocator, bytes32 merkleRoot, bytes32 publishTxHash, bytes32 manifestHash, uint64 epoch)',
  'function getJoinRequest(uint256 requestId) view returns ((address requester, bytes pubkey, string pubkeyRef, string metadataRef, uint8 status))',
  // --- Organization + fund request ---
  'function organization() view returns (address)',
  'function nextFundRequestId() view returns (uint256)',
  'function setOrganization(address newOrganization)',
  'function requestFunds(uint256 amount, string reason) returns (uint256 requestId)',
  'function cancelFundRequest(uint256 requestId)',
  'function markFundRequestApproved(uint256 requestId)',
  'function markFundRequestRejected(uint256 requestId, string reason)',
  'function getFundRequest(uint256 requestId) view returns ((address requester, uint256 amount, string reason, uint8 status, uint64 createdAt, uint64 resolvedAt))',
  'event JoinRequested(uint256 indexed requestId, address indexed requester, bytes pubkey, string pubkeyRef, string metadataRef)',
  'event JoinApproved(uint256 indexed requestId, address indexed requester, address indexed approver, uint64 epoch)',
  'event MemberRemoved(address indexed member, address indexed by, uint64 epoch)',
  'event EpochRotated(uint64 indexed oldEpoch, uint64 indexed newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint64 membershipVersion)',
  'event BackupRequested(address indexed requestedBy, uint64 indexed epoch, string reason, string targetRef, uint64 deadline, uint64 timestamp)',
  'event MemberFileMappingUpdated(address indexed member, uint64 indexed epoch, string storageLocator, bytes32 merkleRoot, bytes32 publishTxHash, bytes32 manifestHash, address indexed by)',
  'event OrganizationSet(address indexed oldOrganization, address indexed newOrganization, address indexed by)',
  'event FundRequested(uint256 indexed requestId, address indexed requester, uint256 amount, string reason)',
  'event FundRequestApproved(uint256 indexed requestId, address indexed requester, address indexed organization, uint256 amount)',
  'event FundRequestRejected(uint256 indexed requestId, address indexed requester, address indexed organization, string reason)',
  'event FundRequestCancelled(uint256 indexed requestId, address indexed requester)',
  'function postMessage(address to, string topic, uint64 seq, uint64 epoch, string payloadRef, bytes32 payloadHash, uint64 ttl)',
  'function getLastSenderSeq(address sender) view returns (uint64)',
  'event AgentMessagePosted(address indexed from, address indexed to, string topic, uint64 seq, uint64 epoch, string payloadRef, bytes32 payloadHash, uint64 ttl, uint64 timestamp)',
] as const;

export const SOULVAULT_ORGANIZATION_ABI = [
  'function owner() view returns (address)',
  'function balance() view returns (uint256)',
  'function deposit() payable',
  'function approveFundRequest(address swarm, uint256 requestId)',
  'function rejectFundRequest(address swarm, uint256 requestId, string reason)',
  'function withdraw(address to, uint256 amount)',
  'event FundsDeposited(address indexed from, uint256 amount)',
  'event FundsReleased(address indexed swarm, uint256 indexed requestId, address indexed recipient, uint256 amount)',
  'event FundRequestRejectedByOrganization(address indexed swarm, uint256 indexed requestId, string reason)',
  'event OrganizationWithdrawn(address indexed to, uint256 amount)',
  'function registerSwarm(address swarm)',
  'function removeSwarm(address swarm)',
  'function swarms() view returns (address[])',
  'function isSwarm(address swarm) view returns (bool)',
  'function swarmCount() view returns (uint256)',
  'function orgPaused() view returns (bool)',
  'function pauseOrg()',
  'function unpauseOrg()',
  'event SwarmRegistered(address indexed swarm, address indexed by)',
  'event SwarmRemoved(address indexed swarm, address indexed by)',
  'event OrgPaused(address indexed by)',
  'event OrgUnpaused(address indexed by)',
] as const;

export { SOULVAULT_SWARM_ABI };

async function resolveTargetSwarm(swarm?: string) {
  const profile = swarm ? await getSwarmProfile(swarm) : await getActiveSwarm();
  if (!profile) throw new Error('No swarm profile found. Run `soulvault swarm create` or `soulvault swarm use` first.');
  if (!profile.contractAddress) throw new Error(`Swarm ${profile.slug} does not have a deployed contract address.`);
  return {
    profile,
    contractAddress: profile.contractAddress,
  };
}

export async function getSwarmContractReadonly(swarm?: string) {
  const { profile, contractAddress } = await resolveTargetSwarm(swarm);
  const provider = await createProvider();
  const contract = new Contract(contractAddress, SOULVAULT_SWARM_ABI, provider);
  return { profile, contract };
}

export async function getSwarmContract(swarm?: string) {
  const { profile, contractAddress } = await resolveTargetSwarm(swarm);
  const signer = await createSigner();
  const contract = new Contract(contractAddress, SOULVAULT_SWARM_ABI, signer);
  return { profile, contract };
}

export async function requestJoinSwarm(input: { swarm?: string; pubkeyHex?: string; pubkeyRef?: string; metadataRef?: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const agent = await getAgentProfile();
  if (!agent) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  const pubkey = input.pubkeyHex ?? agent.publicKey;
  const pubkeyRef = input.pubkeyRef ?? `agent-pubkey:${agent.address}`;
  const metadataRef = input.metadataRef ?? (agent.identity?.agentId ? `erc8004:${agent.identity.registry}:${agent.identity.agentId}` : `agent:${agent.address}`);

  const tx = await contract.requestJoin(pubkey, pubkeyRef, metadataRef);
  const receipt = await tx.wait();

  let requestId: string | undefined;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'JoinRequested') {
        requestId = parsed.args.requestId.toString();
        break;
      }
    } catch {
      // ignore
    }
  }

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    requestId,
    pubkeyRef,
    metadataRef,
  };
}

export async function approveJoinSwarm(input: { swarm?: string; requestId: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const tx = await contract.approveJoin(input.requestId);
  const receipt = await tx.wait();
  const [currentEpoch, membershipVersion, memberCount] = await Promise.all([
    contract.currentEpoch(),
    contract.membershipVersion(),
    contract.memberCount(),
  ]);

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    requestId: input.requestId,
    currentEpoch: currentEpoch.toString(),
    membershipVersion: membershipVersion.toString(),
    memberCount: memberCount.toString(),
  };
}

export async function listSwarmMembers(input: { swarm?: string }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const approvedLogs = await contract.queryFilter(contract.filters.JoinApproved(), 0, 'latest');
  const removedLogs = await contract.queryFilter(contract.filters.MemberRemoved(), 0, 'latest');

  const removedSet = new Set(removedLogs.map((log) => String((log as any).args?.member).toLowerCase()));
  const uniqueRequesters = [...new Set(approvedLogs.map((log) => String((log as any).args?.requester)))];

  const members = await Promise.all(uniqueRequesters.map(async (wallet) => {
    const member = await contract.getMember(wallet);
    return {
      wallet,
      active: Boolean(member.active) && !removedSet.has(wallet.toLowerCase()),
      joinedEpoch: member.joinedEpoch.toString(),
      pubkey: member.pubkey,
    };
  }));

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    members,
  };
}

export async function requestBackupForSwarm(input: { swarm?: string; epoch?: number; reason: string; targetRef?: string; deadlineSeconds?: number }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const currentEpoch = Number(await contract.currentEpoch());
  const epoch = input.epoch ?? currentEpoch;
  const now = Math.floor(Date.now() / 1000);
  const deadline = now + (input.deadlineSeconds ?? 3600);
  const tx = await contract.requestBackup(epoch, input.reason, input.targetRef ?? '', deadline);
  const receipt = await tx.wait();
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    epoch,
    reason: input.reason,
    targetRef: input.targetRef ?? '',
    deadline,
    txHash: receipt?.hash,
  };
}

export async function listRecentSwarmEvents(input: { swarm?: string; fromBlock?: number; toBlock?: number | 'latest' }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const fromBlock = input.fromBlock ?? 0;
  const toBlock = input.toBlock ?? 'latest';

  const [
    joinRequested,
    joinApproved,
    memberRemoved,
    epochRotated,
    backupRequested,
    mappingUpdated,
    messagesPosted,
    organizationSet,
    fundRequested,
    fundApproved,
    fundRejected,
    fundCancelled,
  ] = await Promise.all([
    contract.queryFilter(contract.filters.JoinRequested(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.JoinApproved(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.MemberRemoved(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.EpochRotated(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.BackupRequested(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.MemberFileMappingUpdated(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.AgentMessagePosted(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.OrganizationSet(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.FundRequested(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.FundRequestApproved(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.FundRequestRejected(), fromBlock, toBlock),
    contract.queryFilter(contract.filters.FundRequestCancelled(), fromBlock, toBlock),
  ]);

  const swarmEvents = [
    ...joinRequested.map((log) => ({
      source: 'swarm' as const,
      type: 'JoinRequested',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
    })),
    ...joinApproved.map((log) => ({
      source: 'swarm' as const,
      type: 'JoinApproved',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
      epoch: (log as any).args?.epoch?.toString(),
    })),
    ...memberRemoved.map((log) => ({
      source: 'swarm' as const,
      type: 'MemberRemoved',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      member: String((log as any).args?.member ?? ''),
      epoch: (log as any).args?.epoch?.toString(),
    })),
    ...epochRotated.map((log) => ({
      source: 'swarm' as const,
      type: 'EpochRotated',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      oldEpoch: (log as any).args?.oldEpoch?.toString(),
      newEpoch: (log as any).args?.newEpoch?.toString(),
      keyBundleRef: String((log as any).args?.keyBundleRef ?? ''),
    })),
    ...backupRequested.map((log) => ({
      source: 'swarm' as const,
      type: 'BackupRequested',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestedBy: String((log as any).args?.requestedBy ?? ''),
      epoch: (log as any).args?.epoch?.toString(),
      reason: String((log as any).args?.reason ?? ''),
      targetRef: String((log as any).args?.targetRef ?? ''),
      deadline: (log as any).args?.deadline?.toString(),
    })),
    ...mappingUpdated.map((log) => ({
      source: 'swarm' as const,
      type: 'MemberFileMappingUpdated',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      member: String((log as any).args?.member ?? ''),
      epoch: (log as any).args?.epoch?.toString(),
      storageLocator: String((log as any).args?.storageLocator ?? ''),
    })),
    ...messagesPosted.map((log) => ({
      source: 'swarm' as const,
      type: 'AgentMessagePosted',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      from: String((log as any).args?.from ?? ''),
      to: String((log as any).args?.to ?? ''),
      topic: String((log as any).args?.topic ?? ''),
      seq: (log as any).args?.seq?.toString(),
      epoch: (log as any).args?.epoch?.toString(),
      payloadRef: String((log as any).args?.payloadRef ?? ''),
      ttl: (log as any).args?.ttl?.toString(),
    })),
    ...organizationSet.map((log) => ({
      source: 'swarm' as const,
      type: 'OrganizationSet',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      oldOrganization: String((log as any).args?.oldOrganization ?? ''),
      newOrganization: String((log as any).args?.newOrganization ?? ''),
      by: String((log as any).args?.by ?? ''),
    })),
    ...fundRequested.map((log) => ({
      source: 'swarm' as const,
      type: 'FundRequested',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
      amountWei: (log as any).args?.amount?.toString(),
      reason: String((log as any).args?.reason ?? ''),
    })),
    ...fundApproved.map((log) => ({
      source: 'swarm' as const,
      type: 'FundRequestApproved',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
      organization: String((log as any).args?.organization ?? ''),
      amountWei: (log as any).args?.amount?.toString(),
    })),
    ...fundRejected.map((log) => ({
      source: 'swarm' as const,
      type: 'FundRequestRejected',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
      organization: String((log as any).args?.organization ?? ''),
      reason: String((log as any).args?.reason ?? ''),
    })),
    ...fundCancelled.map((log) => ({
      source: 'swarm' as const,
      type: 'FundRequestCancelled',
      blockNumber: log.blockNumber,
      logIndex: (log as any).index ?? 0,
      txHash: log.transactionHash,
      requestId: (log as any).args?.requestId?.toString(),
      requester: String((log as any).args?.requester ?? ''),
    })),
  ];

  // If the swarm is bound to a treasury, pull treasury-side events and merge.
  // This covers FundsReleased which happens on the treasury (same tx as the swarm's
  // FundRequestApproved event) and needs (blockNumber, logIndex) ordering to render correctly.
  const organizationAddress = String(await contract.organization());
  let organizationEvents: any[] = [];
  if (organizationAddress !== '0x0000000000000000000000000000000000000000') {
    const provider = contract.runner?.provider;
    if (provider) {
      const orgContract = new Contract(organizationAddress, SOULVAULT_ORGANIZATION_ABI, provider);
      const [deposited, released, rejectedByOrganization, withdrawn] = await Promise.all([
        orgContract.queryFilter(orgContract.filters.FundsDeposited(), fromBlock, toBlock),
        orgContract.queryFilter(orgContract.filters.FundsReleased(), fromBlock, toBlock),
        orgContract.queryFilter(orgContract.filters.FundRequestRejectedByOrganization(), fromBlock, toBlock),
        orgContract.queryFilter(orgContract.filters.OrganizationWithdrawn(), fromBlock, toBlock),
      ]);
      organizationEvents = [
        ...deposited.map((log) => ({
          source: 'organization' as const,
          type: 'FundsDeposited',
          blockNumber: log.blockNumber,
          logIndex: (log as any).index ?? 0,
          txHash: log.transactionHash,
          from: String((log as any).args?.from ?? ''),
          amountWei: (log as any).args?.amount?.toString(),
        })),
        ...released.map((log) => ({
          source: 'organization' as const,
          type: 'FundsReleased',
          blockNumber: log.blockNumber,
          logIndex: (log as any).index ?? 0,
          txHash: log.transactionHash,
          swarm: String((log as any).args?.swarm ?? ''),
          requestId: (log as any).args?.requestId?.toString(),
          recipient: String((log as any).args?.recipient ?? ''),
          amountWei: (log as any).args?.amount?.toString(),
        })),
        ...rejectedByOrganization.map((log) => ({
          source: 'organization' as const,
          type: 'FundRequestRejectedByOrganization',
          blockNumber: log.blockNumber,
          logIndex: (log as any).index ?? 0,
          txHash: log.transactionHash,
          swarm: String((log as any).args?.swarm ?? ''),
          requestId: (log as any).args?.requestId?.toString(),
          reason: String((log as any).args?.reason ?? ''),
        })),
        ...withdrawn.map((log) => ({
          source: 'organization' as const,
          type: 'OrganizationWithdrawn',
          blockNumber: log.blockNumber,
          logIndex: (log as any).index ?? 0,
          txHash: log.transactionHash,
          to: String((log as any).args?.to ?? ''),
          amountWei: (log as any).args?.amount?.toString(),
        })),
      ];
    }
  }

  // Sort by (blockNumber, logIndex) so events within the same block preserve their on-chain order.
  // This matters for the FundRequestApproved (swarm) -> FundsReleased (treasury) pair, which
  // happen in the same tx and need to render in the correct sequence.
  const events = [...swarmEvents, ...organizationEvents].sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return (a.logIndex ?? 0) - (b.logIndex ?? 0);
  });

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    organizationAddress: organizationAddress !== '0x0000000000000000000000000000000000000000' ? organizationAddress : undefined,
    fromBlock,
    toBlock,
    events,
  };
}

export async function watchSwarmEvents(input: { swarm?: string; pollSeconds?: number; once?: boolean; fromBlock?: number; onEvents?: (batch: Awaited<ReturnType<typeof listRecentSwarmEvents>>) => Promise<void> | void }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  let cursor = input.fromBlock ?? Math.max(0, Number(await contract.runner?.provider?.getBlockNumber?.() ?? 0) - 20);
  const intervalMs = Math.max(2, input.pollSeconds ?? 5) * 1000;

  while (true) {
    const latestBlock = Number(await contract.runner?.provider?.getBlockNumber?.());
    if (latestBlock >= cursor) {
      const batch = await listRecentSwarmEvents({ swarm: profile.slug, fromBlock: cursor, toBlock: latestBlock });
      if (batch.events.length > 0) {
        console.log(JSON.stringify(batch, null, 2));
        await input.onEvents?.(batch);
      }
      cursor = latestBlock + 1;
    }

    if (input.once) {
      return { swarm: profile.slug, contractAddress: profile.contractAddress, cursor };
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function updateMemberFileMappingOnchain(input: {
  swarm?: string;
  member: string;
  storageLocator: string;
  merkleRoot: string;
  publishTxHash: string;
  manifestHash: string;
  epoch: number;
}) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const payload = {
    member: input.member,
    storageLocator: input.storageLocator,
    merkleRoot: input.merkleRoot,
    publishTxHash: input.publishTxHash,
    manifestHash: input.manifestHash,
    epoch: input.epoch,
  };
  console.error('[updateMemberFileMapping] payload', JSON.stringify({ swarm: profile.slug, contractAddress: profile.contractAddress, payload }, null, 2));
  try {
    const tx = await contract.updateMemberFileMapping(
      input.member,
      input.storageLocator,
      input.merkleRoot,
      input.publishTxHash,
      input.manifestHash,
      input.epoch,
    );
    const receipt = await tx.wait();
    return {
      swarm: profile.slug,
      contractAddress: profile.contractAddress,
      txHash: receipt?.hash,
      epoch: input.epoch,
      member: input.member,
      storageLocator: input.storageLocator,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[updateMemberFileMapping] error', message);
    throw error;
  }
}

export async function postMessageToSwarm(input: {
  swarm?: string;
  to?: string;
  topic: string;
  payloadRef: string;
  payloadHash: string;
  ttl?: number;
}) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const currentEpoch = Number(await contract.currentEpoch());
  const lastSeq = Number(await contract.getLastSenderSeq((await createSigner()).address));
  const seq = lastSeq + 1;
  const to = input.to ?? '0x0000000000000000000000000000000000000000';
  const ttl = input.ttl ?? 3600;

  const tx = await contract.postMessage(to, input.topic, seq, currentEpoch, input.payloadRef, input.payloadHash, ttl);
  const receipt = await tx.wait();

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    from: (await createSigner()).address,
    to,
    topic: input.topic,
    seq,
    epoch: currentEpoch,
    payloadRef: input.payloadRef,
    payloadHash: input.payloadHash,
    ttl,
  };
}

export async function listSwarmMessages(input: { swarm?: string; fromBlock?: number; toBlock?: number | 'latest' }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const fromBlock = input.fromBlock ?? 0;
  const toBlock = input.toBlock ?? 'latest';

  const logs = await contract.queryFilter(contract.filters.AgentMessagePosted(), fromBlock, toBlock);

  const messages = logs.map((log) => ({
    blockNumber: log.blockNumber,
    txHash: log.transactionHash,
    from: String((log as any).args?.from ?? ''),
    to: String((log as any).args?.to ?? ''),
    topic: String((log as any).args?.topic ?? ''),
    seq: (log as any).args?.seq?.toString(),
    epoch: (log as any).args?.epoch?.toString(),
    payloadRef: String((log as any).args?.payloadRef ?? ''),
    payloadHash: String((log as any).args?.payloadHash ?? ''),
    ttl: (log as any).args?.ttl?.toString(),
    timestamp: (log as any).args?.timestamp?.toString(),
  }));

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    fromBlock,
    toBlock,
    messages,
  };
}

export async function getJoinRequestStatus(input: { swarm?: string; requestId: string }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const req = await contract.getJoinRequest(input.requestId);
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    requestId: input.requestId,
    requester: req.requester,
    pubkey: req.pubkey,
    pubkeyRef: req.pubkeyRef,
    metadataRef: req.metadataRef,
    status: Number(req.status),
  };
}

// ---------- Treasury binding + fund request lifecycle ----------

const FUND_STATUS_LABELS = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export function fundStatusLabel(status: number): string {
  return FUND_STATUS_LABELS[status] ?? `unknown(${status})`;
}

/** Read the current `organization()` from the swarm contract. Returns the zero address string if unset. */
export async function readSwarmOrganization(input: { swarm?: string }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const organizationAddress = String(await contract.organization());
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    organizationAddress,
    isSet: organizationAddress !== '0x0000000000000000000000000000000000000000',
  };
}

/** Swarm owner binds the swarm to an organization contract. Re-settable. */
export async function setSwarmOrganization(input: { swarm?: string; organization: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const previous = String(await contract.organization());
  const tx = await contract.setOrganization(input.organization);
  const receipt = await tx.wait();
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    oldOrganization: previous,
    newOrganization: input.organization,
  };
}

/** Active member submits a fund request. Returns the parsed request id. */
export async function requestFundsOnSwarm(input: { swarm?: string; amountWei: bigint; reason: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const tx = await contract.requestFunds(input.amountWei, input.reason);
  const receipt = await tx.wait();

  let requestId: string | undefined;
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === 'FundRequested') {
        requestId = parsed.args.requestId.toString();
        break;
      }
    } catch {
      // ignore logs that don't match this interface
    }
  }

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    requestId,
    amountWei: input.amountWei.toString(),
    reason: input.reason,
  };
}

/** Requester cancels their own pending fund request. */
export async function cancelFundRequestOnSwarm(input: { swarm?: string; requestId: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
  const tx = await contract.cancelFundRequest(input.requestId);
  const receipt = await tx.wait();
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    txHash: receipt?.hash,
    requestId: input.requestId,
  };
}

/** Read a single fund request by id. */
export async function getFundRequestStatus(input: { swarm?: string; requestId: string }) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const req = await contract.getFundRequest(input.requestId);
  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    requestId: input.requestId,
    requester: String(req.requester),
    amountWei: req.amount.toString(),
    reason: String(req.reason),
    status: Number(req.status),
    statusLabel: fundStatusLabel(Number(req.status)),
    createdAt: req.createdAt.toString(),
    resolvedAt: req.resolvedAt.toString(),
  };
}

/** List all fund requests by replaying `FundRequested` events and joining with current on-chain status. */
export async function listFundRequests(input: {
  swarm?: string;
  fromBlock?: number;
  toBlock?: number | 'latest';
  statusFilter?: 'pending' | 'approved' | 'rejected' | 'cancelled';
}) {
  const { profile, contract } = await getSwarmContractReadonly(input.swarm);
  const fromBlock = input.fromBlock ?? 0;
  const toBlock = input.toBlock ?? 'latest';

  const logs = await contract.queryFilter(contract.filters.FundRequested(), fromBlock, toBlock);
  const requests = await Promise.all(
    logs.map(async (log) => {
      const args = (log as any).args;
      const id = args.requestId.toString();
      const current = await contract.getFundRequest(id);
      return {
        requestId: id,
        requester: String(args.requester),
        amountWei: args.amount.toString(),
        reason: String(args.reason),
        status: Number(current.status),
        statusLabel: fundStatusLabel(Number(current.status)),
        createdAt: current.createdAt.toString(),
        resolvedAt: current.resolvedAt.toString(),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      };
    }),
  );

  const filtered = input.statusFilter
    ? requests.filter((r) => r.statusLabel === input.statusFilter)
    : requests;

  return {
    swarm: profile.slug,
    contractAddress: profile.contractAddress,
    fromBlock,
    toBlock,
    requests: filtered,
  };
}
