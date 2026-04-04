import fs from 'fs-extra';
import { Contract, JsonRpcProvider } from 'ethers';
import { getAgentProfile, type AgentProfile } from './agent.js';
import { getActiveOrganization, listOrganizationProfiles, type OrganizationProfile } from './organization.js';
import { getActiveSwarm, listSwarmProfiles, type SwarmProfile } from './swarm.js';
import { loadEnv, type SoulVaultEnv } from './config.js';
import { readConfig, readLastBackup } from './state.js';
import {
  resolveCliStateDir,
  resolveKeysDir,
  resolveSwarmKeysDir,
} from './paths.js';

const READONLY_ABI = [
  'function owner() view returns (address)',
  'function currentEpoch() view returns (uint64)',
  'function membershipVersion() view returns (uint64)',
  'function memberCount() view returns (uint256)',
  'function getMember(address member) view returns ((bool active, bytes pubkey, uint64 joinedEpoch))',
] as const;

export type StatusReport = {
  wallet: {
    signerMode: string;
    address: string | null;
    addressSource: string | null;
    publicKey: string | null;
    ledgerDerivationPath: string | null;
  };
  agent: AgentProfile | null;
  organizations: {
    active: OrganizationProfile | null;
    count: number;
  };
  swarms: {
    active: SwarmProfile | null;
    count: number;
  };
  onchain: {
    reachable: boolean;
    epoch: string | null;
    membershipVersion: string | null;
    memberCount: string | null;
    membership: {
      status: 'active' | 'inactive' | 'not-joined' | 'unknown';
      joinedEpoch: string | null;
    };
    owner: string | null;
  } | null;
  epochKeys: {
    count: number;
    latest: string | null;
  };
  lastBackup: {
    createdAt: string | null;
    epoch: number | null;
    rootHash: string | null;
    workspace: string | null;
  } | null;
  env: {
    opsRpc: string;
    identityRpc: string;
    indexerUrl: string;
    profile: string;
  };
};

async function countEpochKeys(swarmSlug: string): Promise<{ count: number; latest: string | null }> {
  const dir = resolveSwarmKeysDir(swarmSlug);
  if (!(await fs.pathExists(dir))) return { count: 0, latest: null };
  const files = (await fs.readdir(dir)).filter((f) => f.startsWith('epoch-') && f.endsWith('.json'));
  if (files.length === 0) return { count: 0, latest: null };
  const epochs = files.map((f) => Number(f.replace('epoch-', '').replace('.json', ''))).sort((a, b) => a - b);
  return { count: files.length, latest: String(epochs[epochs.length - 1]) };
}

async function probeOnchain(
  swarmProfile: SwarmProfile,
  agentAddress: string | null,
): Promise<StatusReport['onchain']> {
  try {
    const provider = new JsonRpcProvider(swarmProfile.rpcUrl);
    const contract = new Contract(swarmProfile.contractAddress!, READONLY_ABI, provider);

    const [epoch, membershipVersion, memberCount, owner] = await Promise.all([
      contract.currentEpoch(),
      contract.membershipVersion(),
      contract.memberCount(),
      contract.owner(),
    ]);

    let membership: StatusReport['onchain'] extends null ? never : NonNullable<StatusReport['onchain']>['membership'] = {
      status: 'unknown',
      joinedEpoch: null,
    };

    if (agentAddress) {
      try {
        const member = await contract.getMember(agentAddress);
        if (member.active) {
          membership = { status: 'active', joinedEpoch: member.joinedEpoch.toString() };
        } else if (member.joinedEpoch.toString() !== '0') {
          membership = { status: 'inactive', joinedEpoch: member.joinedEpoch.toString() };
        } else {
          membership = { status: 'not-joined', joinedEpoch: null };
        }
      } catch {
        membership = { status: 'unknown', joinedEpoch: null };
      }
    }

    return {
      reachable: true,
      epoch: epoch.toString(),
      membershipVersion: membershipVersion.toString(),
      memberCount: memberCount.toString(),
      membership,
      owner: owner as string,
    };
  } catch {
    return {
      reachable: false,
      epoch: null,
      membershipVersion: null,
      memberCount: null,
      membership: { status: 'unknown', joinedEpoch: null },
      owner: null,
    };
  }
}

export async function gatherStatus(options: { offline?: boolean } = {}): Promise<StatusReport> {
  const env = loadEnv();
  const config = await readConfig<{ activeOrganization?: string; activeSwarm?: string; activeAddress?: string }>();

  const [agent, activeOrg, activeSwarm, orgList, swarmList] = await Promise.all([
    getAgentProfile(),
    getActiveOrganization(),
    getActiveSwarm(),
    listOrganizationProfiles(),
    listSwarmProfiles(),
  ]);

  let agentAddress: string | null = null;
  let addressSource: string | null = null;
  if (agent?.address) {
    agentAddress = agent.address;
    addressSource = 'agent profile';
  } else if (config?.activeAddress) {
    agentAddress = config.activeAddress;
    addressSource = 'config';
  } else if (activeSwarm?.ownerAddress) {
    agentAddress = activeSwarm.ownerAddress;
    addressSource = 'swarm owner';
  } else if (activeOrg?.ownerAddress) {
    agentAddress = activeOrg.ownerAddress;
    addressSource = 'org owner';
  } else if (activeOrg?.ensRegistration?.ownerAddress) {
    agentAddress = activeOrg.ensRegistration.ownerAddress;
    addressSource = 'ENS registration';
  }

  const epochKeys = activeSwarm
    ? await countEpochKeys(activeSwarm.slug)
    : { count: 0, latest: null };

  const onchain =
    !options.offline && activeSwarm?.contractAddress
      ? await probeOnchain(activeSwarm, agentAddress)
      : null;

  const backup = await readLastBackup<{
    createdAt?: string;
    epoch?: number;
    rootHash?: string;
    workspace?: string;
  }>();

  return {
    wallet: {
      signerMode: env.SOULVAULT_SIGNER_MODE,
      address: agentAddress,
      addressSource,
      publicKey: agent?.publicKey ?? null,
      ledgerDerivationPath: env.SOULVAULT_SIGNER_MODE === 'ledger' ? env.SOULVAULT_LEDGER_DERIVATION_PATH : null,
    },
    agent,
    organizations: { active: activeOrg, count: orgList.length },
    swarms: { active: activeSwarm, count: swarmList.length },
    onchain,
    epochKeys,
    lastBackup: backup
      ? {
          createdAt: backup.createdAt ?? null,
          epoch: backup.epoch ?? null,
          rootHash: backup.rootHash ?? null,
          workspace: backup.workspace ?? null,
        }
      : null,
    env: {
      opsRpc: env.SOULVAULT_RPC_URL,
      identityRpc: env.SOULVAULT_ETH_RPC_URL,
      indexerUrl: env.SOULVAULT_0G_INDEXER_URL,
      profile: env.SOULVAULT_PROFILE,
    },
  };
}

function show(value: string | null | undefined): string {
  return value || '—';
}

export function formatStatusText(report: StatusReport): string {
  const lines: string[] = [];
  const push = (text = '') => lines.push(text);
  const kv = (key: string, value: string | number | null | undefined, indent = 2) => {
    const pad = ' '.repeat(indent);
    push(`${pad}${key.padEnd(18)} ${value ?? '—'}`);
  };

  push('SoulVault Status');
  push('═'.repeat(50));

  push();
  push('Wallet');
  kv('Mode', report.wallet.signerMode);
  if (report.wallet.signerMode === 'ledger') {
    kv('Derivation', report.wallet.ledgerDerivationPath ?? "m/44'/60'/0'/0/0");
  }
  kv('Address', report.wallet.address
    ? `${report.wallet.address}${report.wallet.addressSource ? ` (from ${report.wallet.addressSource})` : ''}`
    : '(not configured — run `soulvault agent create` or `soulvault sync`)');
  if (report.wallet.publicKey) {
    kv('Public Key', report.wallet.publicKey);
  }

  push();
  push('Agent');
  if (report.agent) {
    kv('Name', report.agent.name);
    kv('Harness', report.agent.harness);
    if (report.agent.identity?.agentId) {
      kv('ERC-8004', `#${report.agent.identity.agentId} @ ${report.agent.identity.registry}`);
    } else {
      kv('ERC-8004', '(not registered)');
    }
  } else {
    kv('Status', '(no local profile — run `soulvault agent create`)');
  }

  push();
  push(`Organization${report.organizations.count > 1 ? ` (${report.organizations.count} total)` : ''}`);
  if (report.organizations.active) {
    const org = report.organizations.active;
    kv('Name', org.name);
    kv('ENS', org.ensName ?? '(none)');
    kv('Visibility', org.visibility);
    kv('ENS Status', org.ensRegistration?.status ?? '(not configured)');
  } else {
    kv('Status', '(none active)');
  }

  push();
  push(`Swarm${report.swarms.count > 1 ? ` (${report.swarms.count} total)` : ''}`);
  if (report.swarms.active) {
    const sw = report.swarms.active;
    kv('Name', sw.name);
    kv('ENS', sw.ensName ?? '(none)');
    kv('Contract', show(sw.contractAddress));
    kv('Chain', `${sw.chainId}`);
  } else {
    kv('Status', '(none active)');
  }

  if (report.onchain) {
    push();
    push(`On-chain ${report.onchain.reachable ? '(live)' : '(unreachable)'}`);
    if (report.onchain.reachable) {
      kv('Epoch', report.onchain.epoch);
      kv('Members', report.onchain.memberCount);
      kv('Membership Ver.', report.onchain.membershipVersion);
      const ms = report.onchain.membership;
      const memberStr =
        ms.status === 'active'
          ? `active (joined epoch ${ms.joinedEpoch})`
          : ms.status === 'inactive'
            ? `inactive (joined epoch ${ms.joinedEpoch})`
            : ms.status === 'not-joined'
              ? 'not joined'
              : 'unknown';
      kv('You', memberStr);
      kv('Owner', show(report.onchain.owner));
    } else {
      kv('RPC', `${report.env.opsRpc} ✗`);
    }
  }

  push();
  push('Local Keys');
  kv('Epoch keys', report.epochKeys.count > 0 ? `${report.epochKeys.count} (latest: epoch ${report.epochKeys.latest})` : '0');

  push();
  push('Last Backup');
  if (report.lastBackup?.createdAt) {
    kv('Time', report.lastBackup.createdAt);
    kv('Epoch', report.lastBackup.epoch);
    kv('Root Hash', show(report.lastBackup.rootHash));
    kv('Workspace', report.lastBackup.workspace);
  } else {
    kv('Status', '(no backups recorded)');
  }

  push();
  push('Environment');
  kv('Ops RPC', report.env.opsRpc);
  kv('Identity RPC', report.env.identityRpc);
  kv('0G Indexer', report.env.indexerUrl);
  kv('Profile', report.env.profile);
  kv('State Dir', resolveCliStateDir());

  return lines.join('\n');
}
