import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs-extra';
import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from 'ethers';
import { namehash } from 'viem/ens';
import { createOrganizationProfile } from '../organization.js';
import { createSwarmProfile, getSwarmProfile, unpublishSwarm } from '../swarm.js';
import { registerOrganizationEns } from '../ens-name.js';
import {
  createEnsProvider,
  getEnsRegistry,
  readEnsText,
  readOrgSwarmsList,
} from '../ens.js';
import { resolveCliStateDir } from '../paths.js';

/**
 * Integration coverage for swarm visibility and ENS retraction, against a locally
 * running ens-app-v3 node.
 *
 * The unit tests in `swarm-visibility.test.ts` and `swarm-unpublish.test.ts` cover the
 * decision rules and the orchestration with the chain mocked out. What they cannot
 * prove is that the writes and un-writes actually land on a real registry and resolver.
 * That is this file's job, and it is the reason it exists separately: the original bug
 * was precisely that the profile said one thing while ENS said another, so every
 * assertion here reads ENS back rather than trusting the returned profile.
 *
 * Covered:
 *   1. public        — subdomain resolves, label in the org's swarms list
 *   2. semi-private  — subdomain resolves, label NOT in the list
 *   3. private       — nothing on ENS at all (regression test for the original leak)
 *   4. unpublish     — records cleared, subnode released, label stripped
 *   5. --delist-only — label stripped, subdomain still resolving
 *
 * Requires:
 *  - ens-app-v3 running locally (default `localhost:8545`) with a low minCommitmentAge
 *  - `.env.test` populated with SOULVAULT_* vars pointing at that node
 *  - A funded owner signer (SOULVAULT_PRIVATE_KEY) on the identity lane
 *
 * See packages/node/test/global-setup.ts for harness invariants.
 */

/** The legacy single-coin `addr` that `bindSwarmEnsSubdomain` writes. Not in ens.ts,
 *  which only exposes the ENSIP-11 multicoin reader. */
const RESOLVER_ADDR_ABI = ['function addr(bytes32 node) view returns (address)'] as const;

describe('swarm visibility and ENS retraction', () => {
  // ENS names consumed by register-ens cannot be reused across runs.
  const runId = Date.now();
  const ORG_NAME = `svvistest${runId}`;
  const ORG_ENS_NAME = `${ORG_NAME}.eth`;

  let provider: JsonRpcProvider;
  let owner: Wallet;
  let orgSlug: string;

  /** Read the subnode's registry entry — the ground truth for "does this name exist". */
  async function readNode(ensName: string) {
    const registry = await getEnsRegistry(false);
    const node = namehash(ensName);
    const [nodeOwner, resolver] = await Promise.all([registry.owner(node), registry.resolver(node)]);
    return { node, owner: String(nodeOwner), resolver: String(resolver) };
  }

  /** Resolve the swarm contract address through the resolver the registry points at. */
  async function readAddr(ensName: string): Promise<string | null> {
    const { node, resolver } = await readNode(ensName);
    if (resolver.toLowerCase() === ZeroAddress.toLowerCase()) return null;
    const ensProvider = await createEnsProvider();
    const contract = new Contract(resolver, RESOLVER_ADDR_ABI, ensProvider);
    const value = String(await contract.addr(node));
    return value.toLowerCase() === ZeroAddress.toLowerCase() ? null : value;
  }

  const label = (ensName: string) => ensName.replace(`.${ORG_ENS_NAME}`, '');

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (global-setup should populate it)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (global-setup should populate it)');

    provider = new JsonRpcProvider(rpcUrl);
    owner = new Wallet(privateKey, provider);
    await fs.ensureDir(resolveCliStateDir());

    // One org, registered once — the commit→register wait is the slow part of this
    // file and none of the visibility cases need their own org.
    const org = await createOrganizationProfile({
      name: ORG_NAME,
      ensName: ORG_ENS_NAME,
      visibility: 'public',
      ownerAddress: owner.address,
    });
    orgSlug = org.slug;
    const reg = await registerOrganizationEns(orgSlug);
    expect(reg.organization.ensRegistration?.status).toBe('registered');
  }, 300_000);

  it('publishes a public swarm to ENS and lists it on the org', async () => {
    const profile = await createSwarmProfile({
      organization: orgSlug,
      name: `pub${runId}`,
      initialTreasury: ZeroAddress,
      visibility: 'public',
    });

    expect(profile.visibility).toBe('public');
    expect(profile.ensName).toBe(`pub${runId}.${ORG_ENS_NAME}`);
    expect(profile.ensBinding?.status).toBe('bound');

    // Read every claim back off the chain rather than trusting the profile.
    expect((await readAddr(profile.ensName!))?.toLowerCase()).toBe(
      profile.contractAddress!.toLowerCase(),
    );
    expect(await readEnsText(profile.ensName!, 'soulvault.swarmContract')).toBe(
      profile.contractAddress,
    );
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).toContain(label(profile.ensName!));
  }, 180_000);

  it('binds a semi-private swarm but keeps it off the org discovery list', async () => {
    const profile = await createSwarmProfile({
      organization: orgSlug,
      name: `semi${runId}`,
      initialTreasury: ZeroAddress,
      visibility: 'semi-private',
    });

    expect(profile.visibility).toBe('semi-private');
    expect(profile.ensBinding?.status).toBe('bound');

    // Resolvable by anyone who knows the name...
    expect((await readAddr(profile.ensName!))?.toLowerCase()).toBe(
      profile.contractAddress!.toLowerCase(),
    );
    // ...but invisible to anyone walking the org.
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).not.toContain(label(profile.ensName!));
  }, 180_000);

  // The regression test for the original defect: `--private` under an org used to bind
  // a public subdomain and append the label to the org's list regardless.
  it('publishes nothing at all for a private swarm under an org', async () => {
    const name = `priv${runId}`;
    const profile = await createSwarmProfile({
      organization: orgSlug,
      name,
      initialTreasury: ZeroAddress,
      visibility: 'private',
    });

    expect(profile.visibility).toBe('private');
    expect(profile.ensName).toBeUndefined();
    expect(profile.ensBinding).toBeUndefined();
    // Org affiliation and the deployed contract survive — only ENS is withheld.
    expect(profile.organization).toBe(orgSlug);
    expect(profile.contractAddress).toBeDefined();

    // The name the old code would have derived must not exist on the registry.
    const wouldHaveBeen = `${name}.${ORG_ENS_NAME}`;
    const node = await readNode(wouldHaveBeen);
    expect(node.owner.toLowerCase()).toBe(ZeroAddress.toLowerCase());
    expect(await readAddr(wouldHaveBeen)).toBeNull();
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).not.toContain(name);
  }, 180_000);

  it('unpublish clears the records, releases the subnode, and delists', async () => {
    const profile = await createSwarmProfile({
      organization: orgSlug,
      name: `retract${runId}`,
      initialTreasury: ZeroAddress,
      visibility: 'public',
    });
    const ensName = profile.ensName!;

    // Precondition: it really is published.
    expect(await readAddr(ensName)).not.toBeNull();
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).toContain(label(ensName));

    const result = await unpublishSwarm({ nameOrSlug: profile.slug });
    expect(result.subdomainReleased).toBe(true);
    expect(result.visibility).toBe('private');

    // Subnode released: both owner and resolver zeroed on the registry.
    const node = await readNode(ensName);
    expect(node.owner.toLowerCase()).toBe(ZeroAddress.toLowerCase());
    expect(node.resolver.toLowerCase()).toBe(ZeroAddress.toLowerCase());
    expect(await readAddr(ensName)).toBeNull();
    expect(await readEnsText(ensName, 'soulvault.swarmContract')).toBe('');
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).not.toContain(label(ensName));

    // The local profile drops the name but keeps the swarm.
    const after = await getSwarmProfile(profile.slug);
    expect(after?.ensName).toBeUndefined();
    expect(after?.ensBinding).toBeUndefined();
    expect(after?.visibility).toBe('private');
    expect(after?.contractAddress).toBe(profile.contractAddress);
  }, 180_000);

  it('unpublish --delist-only strips the label but leaves the name resolving', async () => {
    const profile = await createSwarmProfile({
      organization: orgSlug,
      name: `delist${runId}`,
      initialTreasury: ZeroAddress,
      visibility: 'public',
    });
    const ensName = profile.ensName!;
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).toContain(label(ensName));

    const result = await unpublishSwarm({ nameOrSlug: profile.slug, mode: 'delist-only' });
    expect(result.visibility).toBe('semi-private');

    // Delisted...
    expect(await readOrgSwarmsList(ORG_ENS_NAME)).not.toContain(label(ensName));
    // ...but still bound and resolving, which is the whole point of the half-step.
    const node = await readNode(ensName);
    expect(node.owner.toLowerCase()).not.toBe(ZeroAddress.toLowerCase());
    expect((await readAddr(ensName))?.toLowerCase()).toBe(profile.contractAddress!.toLowerCase());

    const after = await getSwarmProfile(profile.slug);
    expect(after?.ensName).toBe(ensName);
    expect(after?.visibility).toBe('semi-private');
  }, 180_000);
});
