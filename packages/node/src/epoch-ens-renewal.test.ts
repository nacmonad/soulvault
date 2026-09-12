import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for the Phase 4 epoch→ENSv2 renewal hook (renewSwarmEnsV2Subname).
 * Network-free: the v2 state read, registry client, and org profile store are
 * mocked. Imports the hook from its own light module (epoch-ens-renewal.ts) to
 * avoid epoch-bundle.ts's heavy dependency chain.
 */

const renewCalls: Array<{ registryAddress: string; label: string; expirySeconds: number }> = [];

vi.mock('./ensv2.js', () => ({
  readEnsV2NameState: vi.fn(async (fullName: string) =>
    fullName === 'ops.soulvault.eth'
      ? { status: 2, expiry: 0, latestOwner: '0x0', tokenId: 1n, resource: 2n, registryAddress: '0xreg' }
      : null,
  ),
}));

vi.mock('./ensv2-registry.js', () => ({
  renewEnsV2Subname: vi.fn(async (input: { registryAddress: string; label: string; expirySeconds: number }) => {
    renewCalls.push(input);
    return { registryAddress: input.registryAddress, label: input.label, newExpiry: '1893456000', txHash: '0xrenewtx' };
  }),
}));

vi.mock('./organization.js', () => ({
  getOrganizationProfile: vi.fn(async (nameOrSlug: string) =>
    nameOrSlug === 'soulvault.eth'
      ? { slug: 'soulvault', ensName: 'soulvault.eth', ensv2Registry: { address: '0xOrgRegistry', owner: '0x0', deployedAt: '' } }
      : null,
  ),
}));

// swarm-contract.js is NOT mocked: renewSwarmEnsV2Subname doesn't touch it, and the
// real module's ABI exports are needed by sibling imports in epoch-bundle.ts.
const BASE_PROFILE = {
  slug: 'ops',
  name: 'ops',
  chainId: 11155111,
  contractAddress: '0xswarm',
  ensName: 'ops.soulvault.eth',
  organizationEnsName: 'soulvault.eth',
  visibility: 'public' as const,
  createdAt: '',
  updatedAt: '',
};

describe('renewSwarmEnsV2Subname', () => {
  beforeEach(() => {
    renewCalls.length = 0;
  });

  it('renews via the org registry with the 30d default and reports the tx', async () => {
    const { renewSwarmEnsV2Subname } = await import('./epoch-ens-renewal.js');
    const r = await renewSwarmEnsV2Subname({ ...BASE_PROFILE });
    expect(r.renewed).toBe(true);
    expect(r.fullName).toBe('ops.soulvault.eth');
    expect(r.txHash).toBe('0xrenewtx');
    expect(renewCalls).toHaveLength(1);
    expect(renewCalls[0].registryAddress).toBe('0xOrgRegistry');
    expect(renewCalls[0].label).toBe('ops');
    expect(renewCalls[0].expirySeconds).toBe(30 * 86400);
  });

  it('honors an explicit expiry override', async () => {
    const { renewSwarmEnsV2Subname } = await import('./epoch-ens-renewal.js');
    await renewSwarmEnsV2Subname({ ...BASE_PROFILE }, { expirySeconds: 7 * 86400 });
    expect(renewCalls[0].expirySeconds).toBe(7 * 86400);
  });

  it('no-ops (with reason) when the swarm has no v2 subname', async () => {
    const { renewSwarmEnsV2Subname } = await import('./epoch-ens-renewal.js');
    const r = await renewSwarmEnsV2Subname({ ...BASE_PROFILE, ensName: undefined, organizationEnsName: undefined });
    expect(r).toEqual({ renewed: false, reason: 'no v2 subname bound to this swarm' });
    expect(renewCalls).toHaveLength(0);
  });

  it('no-ops when the org has no deployed registry (v1-only setups keep rotating epochs)', async () => {
    const org = await import('./organization.js');
    vi.mocked(org.getOrganizationProfile).mockResolvedValueOnce({
      slug: 'soulvault',
      ensName: 'soulvault.eth',
      createdAt: '',
      updatedAt: '',
    } as never);
    const { renewSwarmEnsV2Subname } = await import('./epoch-ens-renewal.js');
    const r = await renewSwarmEnsV2Subname({ ...BASE_PROFILE });
    expect(r.renewed).toBe(false);
    expect(r.reason).toContain('deploy-registry');
    expect(renewCalls).toHaveLength(0);
  });

  it('no-ops when the name is not registered on ENSv2', async () => {
    const ensv2 = await import('./ensv2.js');
    vi.mocked(ensv2.readEnsV2NameState).mockResolvedValueOnce(null);
    const { renewSwarmEnsV2Subname } = await import('./epoch-ens-renewal.js');
    const r = await renewSwarmEnsV2Subname({ ...BASE_PROFILE });
    expect(r.renewed).toBe(false);
    expect(r.reason).toContain('not registered on ENSv2');
    expect(renewCalls).toHaveLength(0);
  });
});
