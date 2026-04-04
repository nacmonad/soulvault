import { Contract } from 'ethers';
import { getActiveSwarm, getSwarmProfile } from './swarm.js';
import { createSigner } from './signer.js';
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
  'function getJoinRequest(uint256 requestId) view returns ((address requester, bytes pubkey, string pubkeyRef, string metadataRef, uint8 status))',
  'event JoinRequested(uint256 indexed requestId, address indexed requester, bytes pubkey, string pubkeyRef, string metadataRef)',
  'event JoinApproved(uint256 indexed requestId, address indexed requester, address indexed approver, uint64 epoch)',
  'event MemberRemoved(address indexed member, address indexed by, uint64 epoch)',
  'event EpochRotated(uint64 indexed oldEpoch, uint64 indexed newEpoch, string keyBundleRef, bytes32 keyBundleHash, uint64 membershipVersion)',
] as const;

async function resolveTargetSwarm(swarm?: string) {
  const profile = swarm ? await getSwarmProfile(swarm) : await getActiveSwarm();
  if (!profile) throw new Error('No swarm profile found. Run `soulvault swarm create` or `soulvault swarm use` first.');
  if (!profile.contractAddress) throw new Error(`Swarm ${profile.slug} does not have a deployed contract address.`);
  return {
    profile,
    contractAddress: profile.contractAddress,
  };
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
  const { profile, contract } = await getSwarmContract(input.swarm);
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

export async function getJoinRequestStatus(input: { swarm?: string; requestId: string }) {
  const { profile, contract } = await getSwarmContract(input.swarm);
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
