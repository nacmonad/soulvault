import fs from 'fs-extra';
import { normalize } from 'viem/ens';
import { loadEnv } from './config.js';
import { describeSigner } from './signer.js';
import { readConfig, readJsonIfExists, writeConfig } from './state.js';
import { resolveOrganizationPath, resolveOrganizationsDir } from './paths.js';

export type OrganizationProfile = {
  name: string;
  slug: string;
  ensName?: string;
  visibility: 'public' | 'private' | 'semi-private';
  ethRpcUrl: string;
  ensRpcUrl: string;
  ensChainId: number;
  ownerAddress?: string;
  ensRegistration?: {
    status: 'planned' | 'registered';
    checkedAt?: string;
    txHash?: string;
    ownerAddress?: string;
  };
  createdAt: string;
  updatedAt: string;
};

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'organization';
}

export async function createOrganizationProfile(input: {
  name: string;
  ensName?: string;
  visibility?: 'public' | 'private' | 'semi-private';
  ownerAddress?: string;
}) {
  const env = loadEnv();
  const slug = slugify(input.name);
  const now = new Date().toISOString();
  const signer = await describeSigner().catch(() => null);
  const profile: OrganizationProfile = {
    name: input.name,
    slug,
    ensName: input.ensName,
    visibility: input.visibility ?? (input.ensName ? 'public' : 'private'),
    ethRpcUrl: env.SOULVAULT_ETH_RPC_URL,
    ensRpcUrl: env.SOULVAULT_ENS_RPC_URL,
    ensChainId: env.SOULVAULT_ENS_CHAIN_ID,
    ownerAddress: input.ownerAddress ?? signer?.address,
    ensRegistration: input.ensName ? { status: 'planned' } : undefined,
    createdAt: now,
    updatedAt: now,
  };

  await fs.ensureDir(resolveOrganizationsDir());
  await fs.writeJson(resolveOrganizationPath(slug), profile, { spaces: 2 });
  await writeConfig({ activeOrganization: slug });
  return profile;
}

/** Normalize and validate a root ENS label (e.g. `foo.eth`). */
export function normalizeRootEthEnsName(name: string) {
  const normalized = normalize(name.trim());
  const parts = normalized.split('.');
  if (parts.length !== 2 || parts[1] !== 'eth') {
    throw new Error(`Only root .eth organization names are supported right now. Got: ${name}`);
  }
  return normalized;
}

/**
 * Attach a root `.eth` name to an existing local profile so `register-ens` can run.
 * Does not register on-chain (use `organization register-ens` after).
 */
export async function setOrganizationEnsName(input: { nameOrSlug: string; ensName: string }) {
  const profile = await getOrganizationProfile(input.nameOrSlug);
  if (!profile) {
    throw new Error(`Organization not found: ${input.nameOrSlug}`);
  }

  if (profile.ensRegistration?.status === 'registered') {
    throw new Error(
      `Organization ${profile.slug} already has a completed ENS registration (${profile.ensName}). Refusing to change ensName.`,
    );
  }

  const ensName = normalizeRootEthEnsName(input.ensName);
  const now = new Date().toISOString();
  const updated: OrganizationProfile = {
    ...profile,
    ensName,
    ensRegistration: { status: 'planned' },
    updatedAt: now,
  };

  await fs.writeJson(resolveOrganizationPath(profile.slug), updated, { spaces: 2 });
  return updated;
}

export async function getOrganizationProfile(nameOrSlug: string) {
  const direct = await readJsonIfExists<OrganizationProfile>(resolveOrganizationPath(nameOrSlug));
  if (direct) return direct;

  const dir = resolveOrganizationsDir();
  if (!(await fs.pathExists(dir))) return null;
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const profile = await fs.readJson(resolveOrganizationPath(file.replace(/\.json$/, ''))) as OrganizationProfile;
    if (profile.name === nameOrSlug || profile.ensName === nameOrSlug) return profile;
  }
  return null;
}

export async function listOrganizationProfiles() {
  const dir = resolveOrganizationsDir();
  if (!(await fs.pathExists(dir))) return [] as OrganizationProfile[];
  const files = await fs.readdir(dir);
  const profiles: OrganizationProfile[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    profiles.push(await fs.readJson(resolveOrganizationPath(file.replace(/\.json$/, ''))) as OrganizationProfile);
  }
  return profiles.sort((a, b) => a.slug.localeCompare(b.slug));
}

export async function useOrganization(nameOrSlug: string) {
  const profile = await getOrganizationProfile(nameOrSlug);
  if (!profile) throw new Error(`Organization not found: ${nameOrSlug}`);
  await writeConfig({ activeOrganization: profile.slug });
  return profile;
}

export async function getActiveOrganization() {
  const config = await readConfig<{ activeOrganization?: string }>();
  if (!config?.activeOrganization) return null;
  return getOrganizationProfile(config.activeOrganization);
}
