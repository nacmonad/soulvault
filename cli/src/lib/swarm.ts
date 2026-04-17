import fs from 'fs-extra';
import path from 'node:path';
import { ZeroAddress } from 'ethers';
import { loadEnv } from './config.js';
import { getOrganizationProfile } from './organization.js';
import { resolveSwarmPath, resolveSwarmsDir } from './paths.js';
import { readConfig, readJsonIfExists, writeConfig } from './state.js';
import { bindSwarmEnsSubdomain, deploySoulVaultSwarmContract } from './swarm-deploy.js';
import { addSwarmToOrgList, removeSwarmFromOrgList } from './ens.js';

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
  /**
   * Treasury to pass as the swarm constructor's `initialTreasury` argument. Must be a
   * valid address (or `ZeroAddress` for stealth/deferred binding). Resolution of the
   * treasury from the org's ENS addr record happens in the CLI command layer — this
   * lib function expects the caller to have already decided.
   */
  initialTreasury?: string;
  ensName?: string;
  visibility?: 'public' | 'private' | 'semi-private';
}) {
  const env = loadEnv();
  const organization = input.organization ? await getOrganizationProfile(input.organization) : null;
  if (input.organization && !organization) throw new Error(`Organization not found: ${input.organization}`);

  const initialTreasury = input.initialTreasury ?? ZeroAddress;
  const deployment = input.contractAddress
    ? null
    : await deploySoulVaultSwarmContract({ initialTreasury });
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

    // Append this swarm's label to the org's CBOR `soulvault.swarms` list on the org
    // ENS name. Best-effort: a failure here (e.g. network blip) shouldn't unwind an
    // already-deployed swarm contract or a successfully-bound subdomain. Log and
    // continue; the user can re-run a future `organization sync-swarms` to reconcile.
    const label = ensName.replace(`.${organization.ensName}`, '');
    try {
      await addSwarmToOrgList(organization.ensName, label);
    } catch (err) {
      console.error(
        `[swarm create] WARNING: failed to append "${label}" to ${organization.ensName}'s ` +
          `soulvault.swarms list: ${(err as Error).message} — ` +
          `the swarm is deployed and its subdomain is bound, but the parent org's ` +
          `discovery list was not updated. Re-run with --force or reconcile manually.`,
      );
    }
  }

  // Hint-only cache of the treasury the swarm was born with — the contract is the
  // authoritative source. Only populate for non-zero values; stealth swarms leave this unset.
  const treasuryHint = initialTreasury !== ZeroAddress ? initialTreasury : undefined;

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
    treasuryAddress: treasuryHint,
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

// ---------------------------------------------------------------------------
// Swarm removal (local archive + best-effort ENS cleanup)
// ---------------------------------------------------------------------------

export type SwarmArchiveEntry = SwarmProfile & {
  archived: {
    at: string;
    reason?: string;
  };
};

function resolveSwarmArchiveDir() {
  return path.join(resolveSwarmsDir(), '.archived');
}

function resolveSwarmArchivePath(slug: string) {
  return path.join(resolveSwarmArchiveDir(), `${slug}.json`);
}

/**
 * Move a swarm profile into the `.archived/` directory instead of deleting it outright.
 * Preserves recovery: the contract address, chain id, and org linkage all stay on disk,
 * so a future `swarm reattach` command can un-archive by reading this file. The original
 * profile file at `~/.soulvault/swarms/<slug>.json` is removed.
 */
export async function archiveSwarmProfile(slug: string, reason?: string): Promise<SwarmArchiveEntry> {
  const sourcePath = resolveSwarmPath(slug);
  const existing = await readJsonIfExists<SwarmProfile>(sourcePath);
  if (!existing) throw new Error(`Swarm not found: ${slug}`);

  const entry: SwarmArchiveEntry = {
    ...existing,
    archived: {
      at: new Date().toISOString(),
      reason,
    },
  };

  const archivePath = resolveSwarmArchivePath(slug);
  await fs.ensureDir(resolveSwarmArchiveDir());
  await fs.writeJson(archivePath, entry, { spaces: 2 });
  await fs.remove(sourcePath);

  // Clear active swarm pointer if we just archived the active one.
  const config = await readConfig<{ activeSwarm?: string }>();
  if (config?.activeSwarm === slug) {
    await writeConfig({ activeSwarm: undefined });
  }
  return entry;
}

/**
 * Remove a swarm from its parent org's CBOR `soulvault.swarms` list. Safe to call even
 * if the swarm has no org or no ENS binding; returns quickly in those cases.
 */
export async function unlinkSwarmFromOrgList(profile: SwarmProfile): Promise<{ changed: boolean; error?: string }> {
  if (!profile.organizationEnsName || !profile.ensName) return { changed: false };
  const label = profile.ensName.replace(`.${profile.organizationEnsName}`, '');
  try {
    const result = await removeSwarmFromOrgList(profile.organizationEnsName, label);
    return { changed: result !== null };
  } catch (err) {
    return { changed: false, error: (err as Error).message };
  }
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
