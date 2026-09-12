import fs from 'fs-extra';
import { loadEnv } from './config.js';
import { getOrganizationProfile, getActiveOrganization } from './organization.js';
import { resolveTreasuriesDir, resolveTreasuryPath } from './paths.js';
import { readJsonIfExists } from './state.js';

/**
 * ENS binding info for a single treasury (mirrors the ENSIP-11 write on the
 * org's ENS name: `setAddr(node, coinType, addr)`).
 */
export type TreasuryEnsBinding = {
  status: 'planned' | 'bound';
  // ENSIP-11 coinType used when writing the treasury's `addr` record on the org
  // ENS name (`0x80000000 | chainId`, unsigned). Populated on successful bind.
  coinType?: number;
  // Hash of the resolver `setAddr(node, coinType, addr)` tx.
  addrTxHash?: string;
};

/**
 * One treasury, on one chain. An org may hold treasuries on multiple chains
 * (Sepolia ops lane, 0G Galileo, Base, …) — each is a distinct entry here, just
 * as each gets a distinct ENSIP-11 coinType slot and a distinct entry in the
 * org's `soulvault.treasuries` ENS record.
 */
export type TreasuryChainEntry = {
  chainId: number;
  rpcUrl: string;
  contractAddress: string;
  ownerAddress?: string;
  createdAt: string;
  updatedAt: string;
  deployment?: {
    txHash?: string;
  };
  ensBinding?: TreasuryEnsBinding;
};

/**
 * TreasuryProfile — one per organization, holding one entry per chain.
 *
 * Stored at `~/.soulvault/treasuries/<orgSlug>.json`. Earlier versions stored a
 * single treasury directly on this object (`contractAddress`/`chainId` fields);
 * those files are migrated on read by `normalizeTreasuryProfile`.
 */
export type TreasuryProfile = {
  organization: string; // org slug (also used as the file name)
  organizationEnsName?: string;
  createdAt: string;
  updatedAt: string;
  treasuries: TreasuryChainEntry[];
};

/** The org's treasury on the given chain (defaults to the current env chain). */
export function findTreasuryEntry(
  profile: TreasuryProfile | null | undefined,
  chainId?: number,
): TreasuryChainEntry | undefined {
  if (!profile) return undefined;
  const target = chainId ?? loadEnv().SOULVAULT_CHAIN_ID;
  return profile.treasuries.find((entry) => entry.chainId === target);
}

/**
 * Migrate legacy single-treasury profiles (`contractAddress`/`chainId` on the
 * top-level object) into the per-chain entries shape. Returns null for
 * unrecognizable content.
 */
export function normalizeTreasuryProfile(raw: unknown): TreasuryProfile | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;

  if (Array.isArray(record.treasuries)) {
    const treasuries = (record.treasuries as unknown[]).filter(
      (entry): entry is TreasuryChainEntry =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as TreasuryChainEntry).chainId === 'number' &&
        typeof (entry as TreasuryChainEntry).contractAddress === 'string',
    );
    if (typeof record.organization !== 'string') return null;
    return {
      organization: record.organization,
      ...(typeof record.organizationEnsName === 'string'
        ? { organizationEnsName: record.organizationEnsName }
        : {}),
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString(),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
      treasuries,
    };
  }

  // Legacy shape: one treasury directly on the profile object.
  if (
    typeof record.organization === 'string' &&
    typeof record.contractAddress === 'string' &&
    typeof record.chainId === 'number'
  ) {
    const legacyCreatedAt = typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString();
    const legacyUpdatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : legacyCreatedAt;
    const entry: TreasuryChainEntry = {
      chainId: record.chainId,
      rpcUrl: typeof record.rpcUrl === 'string' ? record.rpcUrl : '',
      contractAddress: record.contractAddress,
      ...(typeof record.ownerAddress === 'string' ? { ownerAddress: record.ownerAddress } : {}),
      createdAt: legacyCreatedAt,
      updatedAt: legacyUpdatedAt,
      ...(record.deployment && typeof record.deployment === 'object'
        ? { deployment: record.deployment as TreasuryChainEntry['deployment'] }
        : {}),
      ...(record.ensBinding && typeof record.ensBinding === 'object'
        ? { ensBinding: record.ensBinding as TreasuryEnsBinding }
        : {}),
    };
    return {
      organization: record.organization,
      ...(typeof record.organizationEnsName === 'string'
        ? { organizationEnsName: record.organizationEnsName }
        : {}),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      treasuries: [entry],
    };
  }

  return null;
}

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

export async function getTreasuryProfile(orgSlug: string) {
  const raw = await readJsonIfExists<unknown>(resolveTreasuryPath(orgSlug));
  return normalizeTreasuryProfile(raw);
}

export async function listTreasuryProfiles() {
  const dir = resolveTreasuriesDir();
  if (!(await fs.pathExists(dir))) return [] as TreasuryProfile[];
  const files = await fs.readdir(dir);
  const profiles: TreasuryProfile[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const slug = file.replace(/\.json$/, '');
    const profile = await getTreasuryProfile(slug);
    if (profile) profiles.push(profile);
  }
  return profiles.sort((a, b) => a.organization.localeCompare(b.organization));
}

export async function writeTreasuryProfile(profile: TreasuryProfile) {
  await fs.ensureDir(resolveTreasuriesDir());
  await fs.writeJson(resolveTreasuryPath(profile.organization), profile, { spaces: 2 });
  return profile;
}

/**
 * Resolve the org's treasury entry for the given chain (defaults to the current
 * env chain). Throws with the known per-chain addresses when missing — the caller
 * is expected to have run `treasury create`/`treasury bind` on that chain first.
 */
export async function requireTreasuryEntry(orgSlug: string, chainId?: number) {
  const profile = await getTreasuryProfile(orgSlug);
  const target = chainId ?? loadEnv().SOULVAULT_CHAIN_ID;
  const entry = findTreasuryEntry(profile, target);
  if (!entry) {
    const known = (profile?.treasuries ?? [])
      .map((t) => `${t.chainId} → ${t.contractAddress}`)
      .join(', ');
    throw new Error(
      `No treasury configured for organization "${orgSlug}" on chain ${target}.` +
        (known ? ` Known treasuries: ${known}.` : '') +
        ` Deploy or bind one with SOULVAULT_CHAIN_ID=${target} via \`soulvault treasury create/bind\`.`,
    );
  }
  return { profile: profile as TreasuryProfile, entry };
}

/**
 * Build a TreasuryChainEntry for a fresh bind/deployment result. Does NOT persist —
 * the caller upserts it into the org profile (see `upsertLocalTreasuryEntry`).
 */
export function buildTreasuryEntry(input: {
  contractAddress: string;
  ownerAddress?: string;
  deploymentTxHash?: string;
  ensBinding?: TreasuryEnsBinding;
  chainId?: number;
  rpcUrl?: string;
}): TreasuryChainEntry {
  const env = loadEnv();
  const now = new Date().toISOString();
  return {
    chainId: input.chainId ?? env.SOULVAULT_CHAIN_ID,
    rpcUrl: input.rpcUrl ?? env.SOULVAULT_RPC_URL,
    contractAddress: input.contractAddress,
    ...(input.ownerAddress ? { ownerAddress: input.ownerAddress } : {}),
    createdAt: now,
    updatedAt: now,
    ...(input.deploymentTxHash ? { deployment: { txHash: input.deploymentTxHash } } : {}),
    ...(input.ensBinding ? { ensBinding: input.ensBinding } : {}),
  };
}

/**
 * Insert or replace the org's treasury entry for the entry's chain, keeping the
 * original createdAt when replacing the same address (rebinds). Other chains'
 * entries are untouched. Persists the profile.
 */
export async function upsertLocalTreasuryEntry(input: {
  organization: string;
  organizationEnsName?: string;
  entry: TreasuryChainEntry;
}) {
  const existing = await getTreasuryProfile(input.organization);
  const prior = existing?.treasuries.find(
    (t) => t.chainId === input.entry.chainId && t.contractAddress === input.entry.contractAddress,
  );
  const entry: TreasuryChainEntry = prior
    ? { ...input.entry, createdAt: prior.createdAt }
    : input.entry;

  const profile: TreasuryProfile = existing
    ? {
        ...existing,
        ...(input.organizationEnsName ? { organizationEnsName: input.organizationEnsName } : {}),
        updatedAt: entry.updatedAt,
        treasuries: [
          ...existing.treasuries.filter((t) => t.chainId !== entry.chainId),
          entry,
        ].sort((a, b) => a.chainId - b.chainId),
      }
    : {
        organization: input.organization,
        ...(input.organizationEnsName ? { organizationEnsName: input.organizationEnsName } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        treasuries: [entry],
      };

  await writeTreasuryProfile(profile);
  return { profile, entry };
}
