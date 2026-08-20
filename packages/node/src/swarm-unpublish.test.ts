import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Both ENS seams are mocked: this exercises the orchestration and the profile
// bookkeeping, not the chain calls. `unbindSwarmEnsSubdomain` itself is covered by
// the integration lane, which needs a real registry and resolver.
const removeSwarmFromOrgList = vi.fn();
const unbindSwarmEnsSubdomain = vi.fn();

vi.mock('./ens.js', () => ({
  addSwarmToOrgList: vi.fn(),
  removeSwarmFromOrgList: (...args: unknown[]) => removeSwarmFromOrgList(...args),
}));

vi.mock('./swarm-deploy.js', () => ({
  bindSwarmEnsSubdomain: vi.fn(),
  deploySoulVaultSwarmContract: vi.fn(),
  unbindSwarmEnsSubdomain: (...args: unknown[]) => unbindSwarmEnsSubdomain(...args),
}));

const { unpublishSwarm } = await import('./swarm.js');
const { resolveSwarmPath, resolveSwarmsDir } = await import('./paths.js');
type SwarmProfile = Awaited<ReturnType<typeof import('./swarm.js').getSwarmProfile>>;

const ORG_ENS = 'acme.eth';
let tempHome: string;
let originalHome: string | undefined;

async function writeProfile(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  const profile = {
    name: 'Ops Crew',
    slug: 'ops-crew',
    organization: 'acme',
    organizationEnsName: ORG_ENS,
    chainId: 16602,
    rpcUrl: 'http://localhost:8545',
    contractAddress: '0x1111111111111111111111111111111111111111',
    ensName: `ops-crew.${ORG_ENS}`,
    visibility: 'public',
    createdAt: now,
    updatedAt: now,
    ensBinding: { status: 'bound' },
    ...overrides,
  };
  await fs.ensureDir(resolveSwarmsDir());
  await fs.writeJson(resolveSwarmPath('ops-crew'), profile, { spaces: 2 });
  return profile;
}

const readProfile = () => fs.readJson(resolveSwarmPath('ops-crew')) as Promise<NonNullable<SwarmProfile>>;

beforeAll(() => {
  originalHome = process.env.HOME;
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvault-unpublish-'));
  process.env.HOME = tempHome;
});

afterAll(() => {
  process.env.HOME = originalHome;
  fs.removeSync(tempHome);
});

beforeEach(async () => {
  vi.clearAllMocks();
  removeSwarmFromOrgList.mockResolvedValue({ hash: '0xdelist' });
  unbindSwarmEnsSubdomain.mockResolvedValue({
    clearAddrTxHash: '0xaddr',
    clearChainIdTextTxHash: '0xchain',
    clearContractTextTxHash: '0xcontract',
    releaseSubdomainTxHash: '0xrelease',
  });
  await fs.remove(resolveSwarmsDir());
});

describe('unpublishSwarm', () => {
  it('retracts a swarm leaked by the old back-derived visibility', async () => {
    // The exact shape the pre-fix code produced: --private honoured on the profile,
    // ignored everywhere that mattered.
    await writeProfile({ visibility: 'private' });

    const result = await unpublishSwarm({ nameOrSlug: 'ops-crew' });

    expect(unbindSwarmEnsSubdomain).toHaveBeenCalledWith({
      organizationEnsName: ORG_ENS,
      swarmEnsName: `ops-crew.${ORG_ENS}`,
    });
    expect(removeSwarmFromOrgList).toHaveBeenCalledWith(ORG_ENS, 'ops-crew');
    expect(result.subdomainReleased).toBe(true);
    expect(result.visibility).toBe('private');
    expect(result.txHashes.releaseSubdomain).toBe('0xrelease');

    const after = await readProfile();
    expect(after.ensName).toBeUndefined();
    expect(after.ensBinding).toBeUndefined();
    expect(after.visibility).toBe('private');
    // Everything that isn't ENS is left alone.
    expect(after.contractAddress).toBe('0x1111111111111111111111111111111111111111');
    expect(after.organization).toBe('acme');
  });

  it('delist-only keeps the subdomain and lands on semi-private', async () => {
    await writeProfile();

    const result = await unpublishSwarm({ nameOrSlug: 'ops-crew', mode: 'delist-only' });

    expect(removeSwarmFromOrgList).toHaveBeenCalledOnce();
    expect(unbindSwarmEnsSubdomain).not.toHaveBeenCalled();
    expect(result.visibility).toBe('semi-private');

    const after = await readProfile();
    expect(after.ensName).toBe(`ops-crew.${ORG_ENS}`);
    expect(after.visibility).toBe('semi-private');
  });

  it('corrects a profile that claims public but never had a name', async () => {
    await writeProfile({ ensName: undefined, organizationEnsName: undefined, ensBinding: undefined });

    const result = await unpublishSwarm({ nameOrSlug: 'ops-crew' });

    expect(removeSwarmFromOrgList).not.toHaveBeenCalled();
    expect(unbindSwarmEnsSubdomain).not.toHaveBeenCalled();
    expect(result.visibility).toBe('private');
    expect((await readProfile()).visibility).toBe('private');
  });

  describe('partial failure', () => {
    // The whole point of this command is that a profile must never claim to be more
    // private than it actually is.
    it('does not claim private when the subdomain could not be cleared', async () => {
      await writeProfile();
      unbindSwarmEnsSubdomain.mockRejectedValue(new Error('resolver reverted'));

      const result = await unpublishSwarm({ nameOrSlug: 'ops-crew' });

      expect(result.subdomainReleased).toBe(false);
      expect(result.subdomainError).toMatch(/resolver reverted/);
      expect(result.visibility).toBe('public');

      const after = await readProfile();
      expect(after.visibility).toBe('public');
      expect(after.ensName).toBe(`ops-crew.${ORG_ENS}`);
    });

    it('does not claim semi-private when the delisting failed', async () => {
      await writeProfile();
      removeSwarmFromOrgList.mockRejectedValue(new Error('ENS RPC unreachable'));

      const result = await unpublishSwarm({ nameOrSlug: 'ops-crew', mode: 'delist-only' });

      expect(result.delistError).toMatch(/unreachable/);
      expect(result.visibility).toBe('public');
      expect((await readProfile()).visibility).toBe('public');
    });

    // A released subnode whose label is still in the org's list is not private in any
    // honest sense — the name is still disclosed, it just stops resolving. Unbinding is
    // also not safely retryable, since clearing resolver records afterwards needs a node
    // the release has already zeroed. So a failed delist must leave ENS untouched.
    it('leaves the subdomain bound when the delisting failed', async () => {
      await writeProfile();
      removeSwarmFromOrgList.mockRejectedValue(new Error('ENS RPC unreachable'));

      const result = await unpublishSwarm({ nameOrSlug: 'ops-crew' });

      expect(result.delistError).toMatch(/unreachable/);
      expect(unbindSwarmEnsSubdomain).not.toHaveBeenCalled();
      expect(result.subdomainReleased).toBe(false);
      expect(result.subdomainError).toMatch(/Skipped/);
      expect(result.visibility).toBe('public');

      const after = await readProfile();
      expect(after.visibility).toBe('public');
      expect(after.ensName).toBe(`ops-crew.${ORG_ENS}`);
    });
  });

  it('rejects an unknown swarm', async () => {
    await expect(unpublishSwarm({ nameOrSlug: 'nope' })).rejects.toThrow(/Swarm not found/);
  });
});
