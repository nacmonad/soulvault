import fs from 'fs-extra';
import path from 'node:path';
import { ZeroAddress } from 'ethers';
import { loadEnv } from './config.js';
import { getOrganizationProfile } from './organization.js';
import { resolveSwarmPath, resolveSwarmsDir } from './paths.js';
import { readConfig, readJsonIfExists, writeConfig } from './state.js';
import {
  bindSwarmEnsSubdomain,
  deploySoulVaultSwarmContract,
  unbindSwarmEnsSubdomain,
} from './swarm-deploy.js';
import { addSwarmToOrgList, readOrgSwarmsList, removeSwarmFromOrgList } from './ens.js';

/**
 * How much of a swarm is published to ENS. This is an *input* that decides what
 * gets written, never a label derived from what happened to be written.
 *
 * - `public`       — subdomain bound, and the label appended to the parent org's
 *                    `soulvault.swarms` list, so the swarm is enumerable from the org.
 * - `semi-private` — subdomain bound, but the label is kept out of the org's list.
 *                    Resolvable by anyone who already knows the name; not discoverable
 *                    by walking the org.
 * - `private`      — no ENS presence at all. The swarm may still be org-affiliated
 *                    locally and hold an org-funded treasury; none of that is published.
 */
export type SwarmVisibility = 'public' | 'private' | 'semi-private';

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
  visibility: SwarmVisibility;
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

/**
 * Re-point a swarm's ops lane (chainId + rpcUrl) in its local profile. The swarm
 * contract itself is immovable — it lives where it was deployed — so this only
 * corrects where subsequent CLI operations send transactions. With `--ens`, the
 * `soulvault.chainId` text record on the swarm's ENS name is rewritten to match
 * (one signature); skip it when the ENS lane is down or the swarm is private.
 */
export async function setSwarmLane(input: {
  swarm?: string;
  chainId?: number;
  rpcUrl?: string;
  updateEns?: boolean;
}) {
  if (input.chainId === undefined && input.rpcUrl === undefined) {
    throw new Error('Nothing to do: pass --chain-id and/or --rpc.');
  }
  if (input.chainId !== undefined && (!Number.isInteger(input.chainId) || input.chainId <= 0)) {
    throw new Error(`Invalid chain id: ${input.chainId}`);
  }
  if (input.rpcUrl !== undefined && !/^https?:\/\//.test(input.rpcUrl)) {
    throw new Error(`Invalid RPC URL: ${input.rpcUrl}`);
  }

  const profile = input.swarm ? await getSwarmProfile(input.swarm) : await getActiveSwarm();
  if (!profile) throw new Error(input.swarm ? `Swarm not found: ${input.swarm}` : 'No active swarm — pass --swarm or run `swarm use` first.');

  const updated = await updateSwarmProfile(profile.slug, {
    ...(input.chainId !== undefined ? { chainId: input.chainId } : {}),
    ...(input.rpcUrl !== undefined ? { rpcUrl: input.rpcUrl } : {}),
  });

  let ensTextTxHash: string | undefined;
  let ensContractTextTxHash: string | undefined;
  let ensTextError: string | undefined;
  if (input.updateEns) {
    if (!profile.ensName || input.chainId === undefined) {
      ensTextError =
        !profile.ensName
          ? 'swarm has no ENS name bound; nothing to update on-chain'
          : 'pass --chain-id to update the ENS text record';
    } else {
      try {
        const { setEnsText } = await import('./ens.js');
        const result = await setEnsText(profile.ensName, 'soulvault.chainId', String(input.chainId));
        ensTextTxHash = result.txHash;
        // Keep the contract record in lockstep: a profile whose contractAddress was
        // corrected (adopted deployment, re-deploy, or a partial bind that left April-era
        // values in place) must not advertise the old address next to the new chainId.
        if (updated.contractAddress && updated.contractAddress !== '0x0000000000000000000000000000000000000000') {
          const contractRecord = await setEnsText(profile.ensName, 'soulvault.swarmContract', updated.contractAddress);
          ensContractTextTxHash = contractRecord.txHash;
        }
      } catch (err) {
        ensTextError = (err as Error).message;
      }
    }
  }

  return {
    slug: updated.slug,
    chainId: updated.chainId,
    rpcUrl: updated.rpcUrl,
    ensTextTxHash,
    ensContractTextTxHash,
    ensTextError,
  };
}

/**
 * Repair a swarm's org-level discoverability: append its label to the parent org's
 * CBOR `soulvault.swarms` list. Covers the crash-between-steps case — subdomain bound
 * (the 4-tx `bindSwarmEnsSubdomain` sequence landed) but the 5th write (the org-list
 * append) never did, leaving the swarm invisible to ENS discovery even though
 * `<label>.<org>.eth` resolves. Idempotent: `addSwarmToOrgList` no-ops when the label
 * is already present.
 *
 * Only `public` swarms may be listed — appending a `semi-private` swarm would defeat
 * its whole reason for existing, and `private` has no ENS binding to publish. `force`
 * exists for the rare deliberate relist of a delisted swarm.
 */
export async function syncSwarmOrgList(input: { swarm?: string; force?: boolean }) {
  const profile = input.swarm ? await getSwarmProfile(input.swarm) : await getActiveSwarm();
  if (!profile) throw new Error(input.swarm ? `Swarm not found: ${input.swarm}` : 'No active swarm — pass --swarm or run `swarm use` first.');
  if (!profile.organizationEnsName || !profile.ensName) {
    throw new Error(
      `Swarm "${profile.slug}" has no ENS binding (visibility "${profile.visibility}"), so there is nothing to publish on the org's swarms list.`,
    );
  }
  if (profile.visibility !== 'public' && !input.force) {
    throw new Error(
      `Swarm "${profile.slug}" is "${profile.visibility}" — its label is deliberately kept off the org's discovery list. ` +
        'Pass --force to list it anyway.',
    );
  }

  const before = await readOrgSwarmsList(profile.organizationEnsName);
  const label = profile.ensName.replace(`.${profile.organizationEnsName}`, '');
  const txHash = await addSwarmToOrgList(profile.organizationEnsName, label);
  const after = await readOrgSwarmsList(profile.organizationEnsName);

  return {
    slug: profile.slug,
    organizationEnsName: profile.organizationEnsName,
    label,
    alreadyListed: txHash === null,
    txHash: txHash ?? undefined,
    swarms: after,
    appended: !before.includes(label) && after.includes(label),
  };
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

export type SwarmEnsPlan = {
  visibility: SwarmVisibility;
  /** The name to bind, or `undefined` when the swarm gets no ENS presence. */
  ensName?: string;
  /** Write the subdomain and its resolver records. */
  bindSubdomain: boolean;
  /** Append the label to the parent org's `soulvault.swarms` discovery list. */
  listInOrg: boolean;
};

/**
 * Decide the ENS consequences of a swarm's visibility, before anything is written.
 *
 * Pure and exported so the rules can be tested without deploying a contract — the
 * previous shape derived `visibility` from whether an ENS name happened to exist,
 * which meant `--private` recorded the leak instead of preventing it.
 *
 * Throws on contradictory input rather than silently picking a winner: quietly
 * downgrading `--public` to private would be surprising, and quietly ignoring
 * `--private` would be a privacy leak.
 */
export function planSwarmEns(input: {
  swarmName: string;
  organizationEnsName?: string;
  explicitEnsName?: string;
  visibility?: SwarmVisibility;
}): SwarmEnsPlan {
  const visibility = input.visibility ?? (input.organizationEnsName ? 'public' : 'private');

  if (visibility === 'private') {
    if (input.explicitEnsName) {
      throw new Error(
        `--ens-name and --private contradict each other: a private swarm publishes no ` +
          `ENS name. Drop one of the two.`,
      );
    }
    return { visibility, ensName: undefined, bindSubdomain: false, listInOrg: false };
  }

  if (!input.organizationEnsName) {
    throw new Error(
      `A ${visibility} swarm needs a parent organization with a registered ENS name to ` +
        `publish under. Pass --organization <nameOrEns>, or use --private for a swarm ` +
        `with no ENS presence.`,
    );
  }

  const ensName = input.explicitEnsName ?? deriveSwarmEnsName(input.swarmName, input.organizationEnsName)!;

  // `bindSwarmEnsSubdomain` strips `.${org}` off the end and uses the remainder as a
  // single label. For a grandchild like `a.b.acme.eth` that yields the label "a.b",
  // so `setSubnodeRecord` creates a node at keccak(namehash(org) ‖ id("a.b")) while
  // the resolver records go to namehash("a.b.acme.eth") — two different nodes. The
  // swarm would resolve to nothing and the org would gain a junk subnode. Require a
  // direct child so the two agree.
  const label = ensName.endsWith(`.${input.organizationEnsName}`)
    ? ensName.slice(0, -`.${input.organizationEnsName}`.length)
    : undefined;
  if (!label || label.includes('.')) {
    throw new Error(
      `ENS name "${ensName}" is not a direct subdomain of the organization's name ` +
        `"${input.organizationEnsName}". Swarm names must be exactly one label below ` +
        `their org (e.g. "ops.${input.organizationEnsName}").`,
    );
  }

  return {
    visibility,
    ensName,
    bindSubdomain: true,
    listInOrg: visibility === 'public',
  };
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
  visibility?: SwarmVisibility;
}) {
  const env = loadEnv();
  const organization = input.organization ? await getOrganizationProfile(input.organization) : null;
  if (input.organization && !organization) throw new Error(`Organization not found: ${input.organization}`);

  // Resolve the ENS plan *before* deploying anything: a contradictory flag
  // combination should fail without having spent gas.
  const plan = planSwarmEns({
    swarmName: input.name,
    organizationEnsName: organization?.ensName,
    explicitEnsName: input.ensName,
    visibility: input.visibility,
  });

  const initialTreasury = input.initialTreasury ?? ZeroAddress;
  const deployment = input.contractAddress
    ? null
    : await deploySoulVaultSwarmContract({ initialTreasury });
  const slug = slugify(input.name);
  const now = new Date().toISOString();
  const ensName = plan.ensName;
  const contractAddress = input.contractAddress ?? deployment?.address;

  let ensBinding: SwarmProfile['ensBinding'];
  if (plan.bindSubdomain && organization?.ensName && ensName && contractAddress) {
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
    // ENS name — public swarms only. A semi-private swarm is resolvable by name but
    // must not be enumerable by walking the org, which is the whole difference between
    // the two levels.
    //
    // Best-effort: a failure here (e.g. network blip) shouldn't unwind an already-
    // deployed swarm contract or a successfully-bound subdomain. Log and continue;
    // the user can re-run a future `organization sync-swarms` to reconcile.
    if (plan.listInOrg) {
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
    visibility: plan.visibility,
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

/**
 * How far to walk a swarm back down the visibility ladder.
 *
 * - `full`        — clear the subdomain's resolver records and release the subnode,
 *                   then strip the label from the org's list. Ends at `private`.
 * - `delist-only` — strip the label from the org's list and leave the subdomain
 *                   resolvable. Ends at `semi-private`.
 */
export type SwarmUnpublishMode = 'full' | 'delist-only';

export type SwarmUnpublishResult = {
  slug: string;
  mode: SwarmUnpublishMode;
  previousVisibility: SwarmVisibility;
  visibility: SwarmVisibility;
  /** The name that was retracted, for the record — it is gone from the profile after a full unpublish. */
  ensName?: string;
  delisted: boolean;
  delistError?: string;
  subdomainReleased: boolean;
  subdomainError?: string;
  txHashes: Record<string, string | undefined>;
};

/**
 * Retract a swarm's ENS presence without touching anything else about it. The contract
 * stays deployed, the local profile stays put, membership and epochs are untouched —
 * this is the counterpart to `swarm remove`, which archives the swarm as a side effect
 * and so cannot be used to fix a swarm that is merely published by mistake.
 *
 * Failures are reported, not thrown, and the recorded visibility only moves as far as
 * the work that actually succeeded. A profile that claims `private` while its subdomain
 * still resolves is the exact failure this command exists to fix, so it must not create
 * one of its own.
 */
export async function unpublishSwarm(input: {
  nameOrSlug: string;
  mode?: SwarmUnpublishMode;
}): Promise<SwarmUnpublishResult> {
  const mode = input.mode ?? 'full';
  const profile = await getSwarmProfile(input.nameOrSlug);
  if (!profile) throw new Error(`Swarm not found: ${input.nameOrSlug}`);

  const base = {
    slug: profile.slug,
    mode,
    previousVisibility: profile.visibility,
    ensName: profile.ensName,
  };

  if (!profile.ensName || !profile.organizationEnsName) {
    // Nothing was ever published. Still correct the profile if it claims otherwise,
    // since a mislabelled record is what sends someone looking for this command.
    const visibility: SwarmVisibility = 'private';
    if (profile.visibility !== visibility) await updateSwarmProfile(profile.slug, { visibility });
    return {
      ...base,
      visibility,
      delisted: false,
      subdomainReleased: false,
      txHashes: {},
    };
  }

  const unlink = await unlinkSwarmFromOrgList(profile);

  if (mode === 'delist-only') {
    // Only claim semi-private if the delisting actually landed.
    const visibility: SwarmVisibility = unlink.error ? profile.visibility : 'semi-private';
    if (visibility !== profile.visibility) await updateSwarmProfile(profile.slug, { visibility });
    return {
      ...base,
      visibility,
      delisted: unlink.changed,
      delistError: unlink.error,
      subdomainReleased: false,
      txHashes: {},
    };
  }

  if (unlink.error) {
    // Stop before touching the subdomain. Two reasons: a released subnode with the
    // label still in the org's list is not `private` in any honest sense — the name
    // is still disclosed, it just doesn't resolve — and unbinding is not safely
    // retryable once done, because clearing the resolver records afterwards needs a
    // node the release has already zeroed. Leaving ENS untouched keeps a re-run clean.
    return {
      ...base,
      visibility: profile.visibility,
      delisted: false,
      delistError: unlink.error,
      subdomainReleased: false,
      subdomainError:
        `Skipped: the swarm could not be removed from the org's discovery list first, ` +
        `so the subdomain was left bound. Re-run once the list update can succeed.`,
      txHashes: {},
    };
  }

  let released = false;
  let subdomainError: string | undefined;
  let txHashes: Record<string, string | undefined> = {};
  try {
    const result = await unbindSwarmEnsSubdomain({
      organizationEnsName: profile.organizationEnsName,
      swarmEnsName: profile.ensName,
    });
    released = true;
    txHashes = {
      clearAddr: result.clearAddrTxHash,
      clearChainIdText: result.clearChainIdTextTxHash,
      clearContractText: result.clearContractTextTxHash,
      releaseSubdomain: result.releaseSubdomainTxHash,
    };
  } catch (err) {
    subdomainError = (err as Error).message;
  }

  if (released) {
    // The name is gone from ENS, so it must go from the profile too — leaving it
    // would have `swarm status` advertising a name that no longer resolves.
    await updateSwarmProfile(profile.slug, {
      visibility: 'private',
      ensName: undefined,
      ensBinding: undefined,
    });
  }

  return {
    ...base,
    visibility: released ? 'private' : profile.visibility,
    delisted: unlink.changed,
    delistError: unlink.error,
    subdomainReleased: released,
    subdomainError,
    txHashes,
  };
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
