import { Contract } from 'ethers';
import { createEnsProvider, createEnsSigner } from './ens.js';
import { getAgentProfile } from './agent.js';
import { loadEnv } from './config.js';
import { writeAgentProfile, writeConfig } from './state.js';

type ServiceInput = { type: string; url: string };

const ERC8004_ADAPTER_ABI = [
  'function registerAgent(address agentWallet, string agentURI) returns (uint256 agentId)',
  'function updateAgentURI(uint256 agentId, string agentURI)',
  'function agentURI(uint256 agentId) view returns (string)',
  'function agentWallet(uint256 agentId) view returns (address)',
  'function agentIdsForWallet(address wallet) view returns (uint256[])',
  'event AgentRegistered(uint256 indexed agentId, address indexed agentWallet, string agentURI)',
] as const;

export function buildAgentRegistration(input: {
  name: string;
  description?: string;
  image?: string;
  harness?: string;
  backupCommand?: string;
  services?: ServiceInput[];
  swarmContract?: string;
  registryAddress?: string;
}) {
  const payload = {
    type: 'SoulVaultAgent',
    name: input.name,
    description: input.description ?? 'SoulVault agent identity',
    image: input.image,
    services: input.services ?? [],
    supportedTrust: ['erc8004', 'soulvault'],
    soulvault: {
      swarmContract: input.swarmContract,
      memberAddress: undefined as string | undefined,
      role: 'member-agent',
      harness: input.harness,
      backupHarnessCommand: input.backupCommand,
      registryAddress: input.registryAddress,
    }
  };

  return payload;
}

export async function renderAgentUri(input: {
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceInput[];
  swarmContract?: string;
  registryAddress?: string;
}) {
  const profile = await getAgentProfile();
  if (!profile) {
    throw new Error('No local agent profile found. Run `soulvault agent create` first.');
  }

  const payload = buildAgentRegistration({
    name: input.name ?? profile.name,
    description: input.description,
    image: input.image,
    harness: profile.harness,
    backupCommand: profile.backupCommand,
    services: input.services,
    swarmContract: input.swarmContract,
    registryAddress: input.registryAddress,
  });

  payload.soulvault.memberAddress = profile.address;

  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  return {
    payload,
    agentURI: `data:application/json;base64,${encoded}`,
  };
}

function getRegistryAddress(explicit?: string) {
  const env = loadEnv();
  const registry = explicit ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS;
  if (!registry) {
    throw new Error('Missing ERC-8004 registry address. Set SOULVAULT_ERC8004_REGISTRY_ADDRESS or pass --registry.');
  }
  return registry;
}

export async function createAgentIdentityOnchain(input: {
  registry?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceInput[];
  swarmContract?: string;
}) {
  const profile = await getAgentProfile();
  if (!profile) throw new Error('No local agent profile found. Run `soulvault agent create` first.');

  const registry = getRegistryAddress(input.registry);
  const signer = await createEnsSigner();
  const contract = new Contract(registry, ERC8004_ADAPTER_ABI, signer);
  const rendered = await renderAgentUri({
    name: input.name,
    description: input.description,
    image: input.image,
    services: input.services,
    swarmContract: input.swarmContract,
    registryAddress: registry,
  });

  const tx = await contract.registerAgent(profile.address, rendered.agentURI);
  const receipt = await tx.wait();
  const agentId = await readAgentIdFromReceipt(contract, receipt?.logs ?? [], profile.address, rendered.agentURI);

  await writeAgentProfile({
    identity: {
      registry,
      agentId: agentId?.toString(),
      txHash: receipt?.hash,
      updatedAt: new Date().toISOString(),
      lastAgentURI: rendered.agentURI,
    }
  });
  await writeConfig({
    registry,
    agentId: agentId?.toString(),
  });

  return {
    registry,
    agentId: agentId?.toString(),
    txHash: receipt?.hash,
    payload: rendered.payload,
    agentURI: rendered.agentURI,
  };
}

export async function updateAgentIdentityOnchain(input: {
  agentId: string;
  registry?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceInput[];
  swarmContract?: string;
}) {
  const registry = getRegistryAddress(input.registry);
  const signer = await createEnsSigner();
  const contract = new Contract(registry, ERC8004_ADAPTER_ABI, signer);
  const rendered = await renderAgentUri({
    name: input.name,
    description: input.description,
    image: input.image,
    services: input.services,
    swarmContract: input.swarmContract,
    registryAddress: registry,
  });

  const tx = await contract.updateAgentURI(input.agentId, rendered.agentURI);
  const receipt = await tx.wait();

  await writeAgentProfile({
    identity: {
      registry,
      agentId: input.agentId,
      txHash: receipt?.hash,
      updatedAt: new Date().toISOString(),
      lastAgentURI: rendered.agentURI,
    }
  });

  return {
    registry,
    agentId: input.agentId,
    txHash: receipt?.hash,
    payload: rendered.payload,
    agentURI: rendered.agentURI,
  };
}

export async function showAgentIdentity(input: { agentId?: string; registry?: string }) {
  const profile = await getAgentProfile();
  const registry = getRegistryAddress(input.registry ?? profile?.identity?.registry);
  const agentId = input.agentId ?? profile?.identity?.agentId;
  if (!agentId) {
    return {
      localProfile: profile,
      note: 'No local identity.agentId found yet. Run identity create-agent first.',
    };
  }

  const provider = await createEnsProvider();
  const contract = new Contract(registry, ERC8004_ADAPTER_ABI, provider);
  const [onchainURI, onchainWallet] = await Promise.all([
    contract.agentURI(agentId),
    contract.agentWallet(agentId),
  ]);

  return {
    registry,
    agentId,
    onchainWallet,
    onchainURI,
    localProfile: profile,
  };
}

export async function findAgentIdentitiesByWallet(input: { wallet: string; registry?: string }) {
  const registry = getRegistryAddress(input.registry);
  const provider = await createEnsProvider();
  const contract = new Contract(registry, ERC8004_ADAPTER_ABI, provider);

  let ids: bigint[] = [];
  try {
    ids = await contract.agentIdsForWallet(input.wallet);
  } catch {
    ids = [];
  }

  if (ids.length === 0) {
    const results: Array<{ agentId: string; wallet: string; agentURI: string; decoded?: unknown }> = [];
    for (let i = 1; i < 512; i++) {
      try {
        const [wallet, uri] = await Promise.all([
          contract.agentWallet(i),
          contract.agentURI(i),
        ]);
        if (String(wallet).toLowerCase() === input.wallet.toLowerCase()) {
          results.push({ agentId: String(i), wallet: String(wallet), agentURI: String(uri), decoded: decodeAgentUri(String(uri)) });
        }
      } catch {
        // skip holes
      }
    }
    return { registry, identities: results };
  }

  const identities = await Promise.all(ids.map(async (id) => {
    const [wallet, uri] = await Promise.all([
      contract.agentWallet(id),
      contract.agentURI(id),
    ]);
    return {
      agentId: id.toString(),
      wallet: String(wallet),
      agentURI: String(uri),
      decoded: decodeAgentUri(String(uri)),
    };
  }));

  return { registry, identities };
}

function decodeAgentUri(agentURI: string) {
  const prefix = 'data:application/json;base64,';
  if (!agentURI.startsWith(prefix)) return undefined;
  try {
    return JSON.parse(Buffer.from(agentURI.slice(prefix.length), 'base64').toString('utf8'));
  } catch {
    return undefined;
  }
}

async function readAgentIdFromReceipt(contract: Contract, logs: readonly unknown[], fallbackWallet: string, fallbackUri: string) {
  for (const raw of logs) {
    try {
      const parsed = contract.interface.parseLog(raw as any);
      if (parsed && parsed.args?.agentId != null) {
        return parsed.args.agentId;
      }
    } catch {
      // ignore non-matching logs
    }
  }

  // Adapter ABI does not define a required event in this scaffold.
  // Fallback: probe small id range and match wallet+uri pair.
  for (let i = 0; i < 512; i++) {
    try {
      const [wallet, uri] = await Promise.all([
        contract.agentWallet(i),
        contract.agentURI(i),
      ]);
      if (String(wallet).toLowerCase() === fallbackWallet.toLowerCase() && String(uri) === fallbackUri) {
        return BigInt(i);
      }
    } catch {
      // hole or unsupported id
    }
  }

  return undefined;
}
