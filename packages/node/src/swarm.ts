import fs from 'fs-extra';
import { loadEnv } from './config.js';
import { getOrganizationProfile } from './organization.js';
import { resolveSwarmPath, resolveSwarmsDir } from './paths.js';
import { readConfig, readJsonIfExists, writeConfig } from './state.js';
import { bindSwarmEnsSubdomain, deploySoulVaultSwarmContract } from './swarm-deploy.js';

export type SwarmProfile = {
  name: string;
  slug: string;
  organization?: string;
  organizationEnsName?: string;
  chainId: number;
  rpcUrl: string;
  ownerAddress?: string;
  contractAddress?: string;
  ensName?: string;
  visibility: 'public' | 'private' | 'semi-private';
  /** Hint-only cache of the bound treasury address from the swarm contract's `treasury()` view.
   *  Never authoritative — mutating flows re-resolve from the contract. */
  treasuryAddress?: string;
  createdAt: string;
  updatedAt: string;
  deployment?: {
    txHash?: string;
  };
  ensBinding?: {
    status: 'planned' | 'bound';
    subdomainTxHash?: string;
    addrTxHash?: string;
    chainIdTextTxHash?: string;
    contractTextTxHash?: string;
  };
};

export async function updateSwarmProfile(slug: string, patch: Partial<SwarmProfile>) {
  const existing = await readJsonIfExists<SwarmProfile>(resolveSwarmPath(slug));
  if (!existing) throw new Error(`Swarm not found: ${slug}`);
  const updated: SwarmProfile = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  await fs.writeJson(resolveSwarmPath(slug), updated, { spaces: 2 });
  return updated;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'swarm';
}

function deriveSwarmEnsName(swarmName: string, organizationEnsName?: string) {
  if (!organizationEnsName) return undefined;
  return `${slugify(swarmName)}.${organizationEnsName}`;
}

export async function createSwarmProfile(input: {
  organization?: string;
  name: string;
  chainId?: number;
  rpcUrl?: string;
  ownerAddress?: string;
  contractAddress?: string;
  ensName?: string;
  visibility?: 'public' | 'private' | 'semi-private';
}) {
  const env = loadEnv();
  const organization = input.organization ? await getOrganizationProfile(input.organization) : null;
  if (input.organization && !organization) throw new Error(`Organization not found: ${input.organization}`);

  const deployment = input.contractAddress ? null : await deploySoulVaultSwarmContract();
  const slug = slugify(input.name);
  const now = new Date().toISOString();
  const ensName = input.ensName ?? deriveSwarmEnsName(input.name, organization?.ensName);
  const contractAddress = input.contractAddress ?? deployment?.address;

  let ensBinding: SwarmProfile['ensBinding'];
  if (organization?.ensName && ensName && contractAddress) {
    const bound = await bindSwarmEnsSubdomain({
      organizationEnsName: organization.ensName,
      swarmEnsName: ensName,
      contractAddress,
    });
    ensBinding = {
      status: 'bound',
      subdomainTxHash: bound.subdomainTxHash,
      addrTxHash: bound.addrTxHash,
      chainIdTextTxHash: bound.chainIdTextTxHash,
      contractTextTxHash: bound.contractTextTxHash,
    };
  }

  const profile: SwarmProfile = {
    name: input.name,
    slug,
    organization: organization?.slug,
    organizationEnsName: organization?.ensName,
    chainId: input.chainId ?? env.SOULVAULT_CHAIN_ID,
    rpcUrl: input.rpcUrl ?? env.SOULVAULT_RPC_URL,
    ownerAddress: input.ownerAddress ?? deployment?.ownerAddress ?? organization?.ownerAddress,
    contractAddress,
    ensName,
    visibility: input.visibility ?? (ensName ? 'public' : 'private'),
    createdAt: now,
    updatedAt: now,
    deployment: deployment ? { txHash: deployment.txHash } : undefined,
    ensBinding,
  };

  await fs.ensureDir(resolveSwarmsDir());
  await fs.writeJson(resolveSwarmPath(slug), profile, { spaces: 2 });
  await writeConfig({ activeSwarm: slug });
  return profile;
}

export async function getSwarmProfile(nameOrSlug: string) {
  const direct = await readJsonIfExists<SwarmProfile>(resolveSwarmPath(nameOrSlug));
  if (direct) return direct;

  const dir = resolveSwarmsDir();
  if (!(await fs.pathExists(dir))) return null;
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const profile = await fs.readJson(resolveSwarmPath(file.replace(/\.json$/, ''))) as SwarmProfile;
    if (profile.name === nameOrSlug || profile.ensName === nameOrSlug) return profile;
  }
  return null;
}

export async function listSwarmProfiles() {
  const dir = resolveSwarmsDir();
  if (!(await fs.pathExists(dir))) return [] as SwarmProfile[];
  const files = await fs.readdir(dir);
  const profiles: SwarmProfile[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    profiles.push(await fs.readJson(resolveSwarmPath(file.replace(/\.json$/, ''))) as SwarmProfile);
  }
  return profiles.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function useSwarm(nameOrSlug: string) {
  const profile = await getSwarmProfile(nameOrSlug);
  if (!profile) throw new Error(`Swarm not found: ${nameOrSlug}`);
  await writeConfig({ activeSwarm: profile.slug });
  return profile;
}

export async function getActiveSwarm() {
  const config = await readConfig<{ activeSwarm?: string }>();
  if (!config?.activeSwarm) return null;
  return getSwarmProfile(config.activeSwarm);
}
