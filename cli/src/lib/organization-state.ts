import fs from 'fs-extra';
import { loadEnv } from './config.js';
import { getOrganizationProfile, getActiveOrganization } from './organization.js';
import { resolveTreasuriesDir, resolveTreasuryPath } from './paths.js';
import { readJsonIfExists } from './state.js';

/**
 * OrganizationContractProfile — one per organization.
 *
 * The organization contract is org-scoped: exactly one SoulVaultOrganization contract per organization,
 * deployed on 0G Galileo (same chain as the swarms it funds), discovered off-chain via
 * ENS text records on the org's Sepolia ENS name.
 *
 * Stored at `~/.soulvault/treasuries/<orgSlug>.json`.
 */
export type OrganizationContractProfile = {
  organization: string; // org slug (also used as the file name)
  organizationEnsName?: string;
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  ownerAddress?: string;
  createdAt: string;
  updatedAt: string;
  deployment?: {
    txHash?: string;
  };
  ensBinding?: {
    status: 'planned' | 'bound';
    chainIdTextTxHash?: string;
    contractTextTxHash?: string;
    daoURITextTxHash?: string;
    membersURITextTxHash?: string;
    governanceURITextTxHash?: string;
    contractsURITextTxHash?: string;
  };
};

/**
 * Resolve the target organization for a treasury command. If the caller passes an explicit
 * `organization` flag we honor it; otherwise fall back to the active-org config. Throws a
 * clear error with actionable next steps when neither is set.
 */
export async function resolveTargetOrganization(orgNameOrSlug?: string) {
  const organization = orgNameOrSlug
    ? await getOrganizationProfile(orgNameOrSlug)
    : await getActiveOrganization();
  if (!organization) {
    throw new Error(
      `No organization profile found. Run \`soulvault organization create\` first, ` +
        `or pass --organization <nameOrEns>.`,
    );
  }
  return organization;
}

export async function getOrganizationContractProfile(orgSlug: string) {
  return readJsonIfExists<OrganizationContractProfile>(resolveTreasuryPath(orgSlug));
}

export async function listOrganizationContractProfiles() {
  const dir = resolveTreasuriesDir();
  if (!(await fs.pathExists(dir))) return [] as OrganizationContractProfile[];
  const files = await fs.readdir(dir);
  const profiles: OrganizationContractProfile[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const slug = file.replace(/\.json$/, '');
    const profile = await getOrganizationContractProfile(slug);
    if (profile) profiles.push(profile);
  }
  return profiles.sort((a, b) => a.organization.localeCompare(b.organization));
}

export async function writeOrganizationContractProfile(profile: OrganizationContractProfile) {
  await fs.ensureDir(resolveTreasuriesDir());
  await fs.writeJson(resolveTreasuryPath(profile.organization), profile, { spaces: 2 });
  return profile;
}

/**
 * Resolve an organization contract profile for the given org. Throws if no profile exists yet —
 * the caller is expected to have run `treasury create` first.
 */
export async function requireOrganizationContractProfile(orgSlug: string) {
  const profile = await getOrganizationContractProfile(orgSlug);
  if (!profile) {
    throw new Error(
      `No organization contract deployed for organization "${orgSlug}". Run \`soulvault treasury create --organization ${orgSlug}\` first.`,
    );
  }
  return profile;
}

/**
 * Build an OrganizationContractProfile record from a fresh deployment result. Does NOT persist —
 * caller decides when to write (e.g. after ENS binding succeeds or falls back to planned).
 */
export function buildOrganizationContractProfile(input: {
  organization: string;
  organizationEnsName?: string;
  contractAddress: string;
  ownerAddress?: string;
  deploymentTxHash?: string;
  ensBinding?: OrganizationContractProfile['ensBinding'];
}): OrganizationContractProfile {
  const env = loadEnv();
  const now = new Date().toISOString();
  return {
    organization: input.organization,
    organizationEnsName: input.organizationEnsName,
    chainId: env.SOULVAULT_CHAIN_ID,
    rpcUrl: env.SOULVAULT_RPC_URL,
    contractAddress: input.contractAddress,
    ownerAddress: input.ownerAddress,
    createdAt: now,
    updatedAt: now,
    deployment: input.deploymentTxHash ? { txHash: input.deploymentTxHash } : undefined,
    ensBinding: input.ensBinding,
  };
}
