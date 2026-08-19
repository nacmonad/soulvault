import fs from 'fs-extra';
import { Contract, JsonRpcProvider } from 'ethers';
import type { AgentProfile } from './agent.js';
import { loadEnv } from './config.js';
import { findAgentIdentitiesByWallet } from './identity.js';
import { normalizeEnsName, readEnsNodeOwner, readEnsText } from './ens.js';
import { getOrganizationProfile, type OrganizationProfile } from './organization.js';
import { resolveOrganizationPath, resolveOrganizationsDir, resolveSwarmPath, resolveSwarmsDir } from './paths.js';
import { readAgentProfile, readJsonIfExists, writeAgentProfile, writeConfig } from './state.js';
import type { SwarmProfile } from './swarm.js';

const SWARM_OWNER_ABI = ['function owner() view returns (address)'] as const;

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'entity';
}

export function parseCommaList(raw?: string): string[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function parseSyncEnsLists(env = loadEnv()) {
  return {
    organizations: parseCommaList(env.SOULVAULT_SYNC_ORGANIZATION_ENS),
    swarms: parseCommaList(env.SOULVAULT_SYNC_SWARM_ENS),
  };
}

/** e.g. `ops.soulvault.eth` → `soulvault.eth`; `soulvault.eth` → null */
export function parentOrgEnsFromSwarmEns(normalizedSwarmEns: string): string | null {
  const parts = normalizedSwarmEns.split('.');
  if (parts.length < 3) return null;
  return parts.slice(1).join('.');
}

function addrEq(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export type LedgerSyncResult = {
  walletAddress: string;
  organizations: { ens: string; slug: string; ok: boolean; error?: string }[];
  swarms: { ens: string; slug: string; ok: boolean; error?: string }[];
  agents: { registry?: string; count: number; merged: boolean; note?: string };
  warnings: string[];
};

async function writeOrganizationFromSync(input: {
  ensName: string;
  walletAddress: string;
  existing?: OrganizationProfile | null;
}): Promise<OrganizationProfile> {
  const env = loadEnv();
  const label = input.ensName.split('.')[0] ?? input.ensName;
  const slug = slugify(label);
  const now = new Date().toISOString();
  const profile: OrganizationProfile = {
    name: input.existing?.name ?? label,
    slug,
    ensName: input.ensName,
    visibility: input.existing?.visibility ?? 'public',
    ethRpcUrl: env.SOULVAULT_ETH_RPC_URL,
    ensRpcUrl: env.SOULVAULT_ENS_RPC_URL,
    ensChainId: env.SOULVAULT_ENS_CHAIN_ID,
    ownerAddress: input.walletAddress,
    ensRegistration: {
      status: 'registered',
      checkedAt: now,
      ownerAddress: input.walletAddress,
    },
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
  };

  await fs.ensureDir(resolveOrganizationsDir());
  await fs.writeJson(resolveOrganizationPath(slug), profile, { spaces: 2 });
  return profile;
}

async function writeSwarmFromSync(input: {
  swarmEns: string;
  walletAddress: string;
  organizationSlug: string;
  organizationEnsName: string;
  contractAddress: string;
  chainId: number;
}): Promise<SwarmProfile> {
  const env = loadEnv();
  const slug = slugify(input.swarmEns.split('.')[0] ?? input.swarmEns);
  const now = new Date().toISOString();
  const existing = await readJsonIfExists<SwarmProfile>(resolveSwarmPath(slug));

  const profile: SwarmProfile = {
    name: existing?.name ?? slug,
    slug,
    organization: input.organizationSlug,
    organizationEnsName: input.organizationEnsName,
    chainId: input.chainId,
    rpcUrl: env.SOULVAULT_RPC_URL,
    ownerAddress: input.walletAddress,
    contractAddress: input.contractAddress,
    ensName: input.swarmEns,
    visibility: existing?.visibility ?? 'public',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deployment: existing?.deployment,
    ensBinding: existing?.ensBinding ?? { status: 'bound' },
  };

  await fs.ensureDir(resolveSwarmsDir());
  await fs.writeJson(resolveSwarmPath(slug), profile, { spaces: 2 });
  return profile;
}

export async function maybeLedgerAutoSync(walletAddress: string) {
  const { organizations, swarms } = parseSyncEnsLists();
  if (organizations.length === 0 && swarms.length === 0) return;
  const res = await runLedgerStateSync({
    walletAddress,
    organizationEns: organizations,
    swarmEns: swarms,
    verbose: false,
  });
  const okOrg = res.organizations.filter((o) => o.ok).length;
  const okSw = res.swarms.filter((s) => s.ok).length;
  if (okOrg || okSw || res.agents.count) {
    console.error(`[soulvault] ledger sync: ${okOrg} org(s), ${okSw} swarm(s), ${res.agents.count} on-chain agent id(s).`);
  }
  for (const w of res.warnings) console.error(`[soulvault] sync: ${w}`);
}

/**
 * Pull local `organizations/*.json` and `swarms/*.json` from ENS text records and on-chain owner checks.
 * Org names must be owned by `walletAddress` on ENS; swarm contracts must report the same owner on the ops chain.
 */
export async function runLedgerStateSync(input: {
  walletAddress: string;
  organizationEns?: string[];
  swarmEns?: string[];
  verbose?: boolean;
}): Promise<LedgerSyncResult> {
  const env = loadEnv();
  const lists = parseSyncEnsLists(env);
  const organizationEnsNames = input.organizationEns ?? lists.organizations;
  const swarmEnsNames = input.swarmEns ?? lists.swarms;
  const verbose = input.verbose ?? true;

  const result: LedgerSyncResult = {
    walletAddress: input.walletAddress,
    organizations: [],
    swarms: [],
    agents: { count: 0, merged: false },
    warnings: [],
  };

  const wallet = input.walletAddress;
  const orgCandidateSet = new Set<string>(organizationEnsNames.map((n) => normalizeEnsName(n)));

  for (const raw of swarmEnsNames) {
    const norm = normalizeEnsName(raw);
    const parent = parentOrgEnsFromSwarmEns(norm);
    if (!parent) {
      result.warnings.push(`Swarm ENS "${raw}" has no parent org subdomain (expected e.g. ops.org.eth). Skipped parent inference.`);
      continue;
    }
    orgCandidateSet.add(parent);
  }

  const syncedOrgByEns = new Map<string, OrganizationProfile>();

  for (const raw of orgCandidateSet) {
    const ens = normalizeEnsName(raw);
    let slug = '';
    try {
      const { owner } = await readEnsNodeOwner(ens);
      if (!addrEq(owner, wallet)) {
        result.organizations.push({
          ens,
          slug: slugify(ens.split('.')[0] ?? ens),
          ok: false,
          error: `ENS owner ${owner} does not match wallet ${wallet}`,
        });
        continue;
      }
      const existing = await getOrganizationProfile(slugify(ens.split('.')[0] ?? ens));
      const profile = await writeOrganizationFromSync({
        ensName: ens,
        walletAddress: wallet,
        existing,
      });
      slug = profile.slug;
      syncedOrgByEns.set(ens, profile);
      result.organizations.push({ ens, slug, ok: true });
      if (verbose) console.error(`sync: organization ${ens} → ~/.soulvault/organizations/${slug}.json`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.organizations.push({
        ens,
        slug: slugify(ens.split('.')[0] ?? ens),
        ok: false,
        error: msg,
      });
    }
  }

  const rpc = new JsonRpcProvider(env.SOULVAULT_RPC_URL, env.SOULVAULT_CHAIN_ID);

  for (const raw of swarmEnsNames) {
    const ens = normalizeEnsName(raw);
    const swarmSlugHint = slugify(ens.split('.')[0] ?? ens);
    try {
      const parent = parentOrgEnsFromSwarmEns(ens);
      if (!parent) {
        result.swarms.push({
          ens,
          slug: swarmSlugHint,
          ok: false,
          error: 'Not a subdomain ENS name (need swarm.organization.eth)',
        });
        continue;
      }

      const orgProfile = syncedOrgByEns.get(parent);
      if (!orgProfile) {
        result.swarms.push({
          ens,
          slug: swarmSlugHint,
          ok: false,
          error: `Parent org ${parent} was not synced (check ENS ownership by this wallet).`,
        });
        continue;
      }

      const contractAddr = (await readEnsText(ens, 'soulvault.swarmContract')).trim();
      const chainText = (await readEnsText(ens, 'soulvault.chainId')).trim();
      if (!contractAddr || !/^0x[a-fA-F0-9]{40}$/.test(contractAddr)) {
        result.swarms.push({
          ens,
          slug: swarmSlugHint,
          ok: false,
          error: 'Missing or invalid soulvault.swarmContract text record',
        });
        continue;
      }

      const chainId = chainText ? Number(chainText) : env.SOULVAULT_CHAIN_ID;
      if (Number.isNaN(chainId) || chainId !== env.SOULVAULT_CHAIN_ID) {
        result.swarms.push({
          ens,
          slug: swarmSlugHint,
          ok: false,
          error: `soulvault.chainId ${chainText || '(empty)'} does not match SOULVAULT_CHAIN_ID ${env.SOULVAULT_CHAIN_ID}`,
        });
        continue;
      }

      const swarmContract = new Contract(contractAddr, SWARM_OWNER_ABI, rpc);
      const onchainOwner = String(await swarmContract.owner());
      if (!addrEq(onchainOwner, wallet)) {
        result.swarms.push({
          ens,
          slug: swarmSlugHint,
          ok: false,
          error: `Swarm contract owner ${onchainOwner} does not match wallet ${wallet}`,
        });
        continue;
      }

      const profile = await writeSwarmFromSync({
        swarmEns: ens,
        walletAddress: wallet,
        organizationSlug: orgProfile.slug,
        organizationEnsName: parent,
        contractAddress: contractAddr,
        chainId,
      });
      result.swarms.push({ ens, slug: profile.slug, ok: true });
      if (verbose) console.error(`sync: swarm ${ens} → ~/.soulvault/swarms/${profile.slug}.json`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.swarms.push({ ens, slug: swarmSlugHint, ok: false, error: msg });
    }
  }

  if (!env.SOULVAULT_ERC8004_REGISTRY_ADDRESS) {
    result.agents.note = 'SOULVAULT_ERC8004_REGISTRY_ADDRESS unset; skipped agent discovery.';
    if (verbose) console.error(`sync: ${result.agents.note}`);
  } else {
    try {
      const { registry, identities } = await findAgentIdentitiesByWallet({ wallet });
      result.agents.registry = registry;
      result.agents.count = identities.length;
      if (verbose) {
        for (const id of identities) {
          console.error(`sync: ERC-8004 agent id=${id.agentId} registry=${registry}`);
        }
      }

      if (identities.length > 1) {
        result.warnings.push('Multiple ERC-8004 identities for this wallet; not merging into agent.json automatically.');
      } else if (identities.length === 1) {
        const local = await readAgentProfile<AgentProfile>();
        if (!local) {
          result.agents.note = 'No local agent.json; skipped identity merge.';
        } else if (!addrEq(local.address, wallet)) {
          result.agents.note = 'agent.json address differs from sync wallet; skipped identity merge.';
        } else {
          const id = identities[0]!;
          await writeAgentProfile({
            identity: {
              ...local.identity,
              registry,
              agentId: id.agentId,
              updatedAt: new Date().toISOString(),
              lastAgentURI: id.agentURI,
            },
          });
          await writeConfig({ registry, agentId: id.agentId });
          result.agents.merged = true;
          if (verbose) console.error('sync: merged ERC-8004 identity into agent.json + config.json');
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.agents.note = `Agent discovery failed: ${msg}`;
      if (verbose) console.error(`sync: ${result.agents.note}`);
    }
  }

  return result;
}
