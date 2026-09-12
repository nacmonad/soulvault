import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Unit tests for ensv2-agent-bridge.ts (Phase 4, item 11) — network-free.
 * Contract calls, signer, profile stores, and setEnsText are mocked.
 */

const registerCalls: Array<{ method: string; args: unknown[] }> = [];
const textWrites: Array<{ name: string; key: string; value: string }> = [];
let agentProfile: Record<string, unknown> | null = {
  name: 'RustyBot',
  address: '0xAgeNt0000000000000000000000000000000002',
  publicKey: '0xpub',
  identity: { registry: '0x8004', agentId: '7' },
};

vi.mock('./agent.js', () => ({
  getAgentProfile: async () => agentProfile,
}));

vi.mock('./state.js', () => ({
  writeAgentProfile: vi.fn(async (patch: Record<string, unknown>) => {
    agentProfile = { ...(agentProfile ?? {}), ...patch };
  }),
}));

vi.mock('./ens.js', () => ({
  createEnsSigner: async () => ({ address: '0x0rg0wner00000000000000000000000000000001' }),
  setEnsText: vi.fn(async (name: string, key: string, value: string) => {
    textWrites.push({ name, key, value });
    return { node: '0xnode', key, value, txHash: `0xtxt-${key}` };
  }),
}));

vi.mock('./ensv2.js', () => ({
  getEnsV2Provider: async () => ({}),
}));

vi.mock('./ensv2-registry.js', () => ({
  ENSV2_USER_REGISTRY_ABI: [{ type: 'function', name: 'register' }],
}));

vi.mock('./organization.js', () => ({
  getOrganizationProfile: async (nameOrSlug: string) =>
    nameOrSlug === 'soulvault.eth'
      ? { slug: 'soulvault', ensName: 'soulvault.eth', ensv2Registry: { address: '0x0rgR3gistry' } }
      : null,
}));

vi.mock('./swarm.js', () => ({
  getSwarmProfile: async (nameOrSlug: string) =>
    nameOrSlug === 'ops'
      ? {
          slug: 'ops',
          name: 'ops',
          ensName: 'ops.soulvault.eth',
          organizationEnsName: 'soulvault.eth',
          chainId: 11155111,
          contractAddress: '0xswarm',
          visibility: 'public',
          createdAt: '',
          updatedAt: '',
        }
      : null,
  getActiveSwarm: async () => null,
}));

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(_target: string, _abi: unknown, _runner?: unknown) {}
    register(...args: unknown[]) {
      registerCalls.push({ method: 'register', args });
      return Promise.resolve({
        wait: async () => ({ hash: '0xregister', logs: [] }),
      });
    }
  }
  return { ...actual, Contract: MockContract as unknown };
});

const ZERO = '0x0000000000000000000000000000000000000000';

describe('buildAgentEnsName', () => {
  it('joins label.swarm.org', async () => {
    const { buildAgentEnsName } = await import('./ensv2-agent-bridge.js');
    expect(buildAgentEnsName({ swarm: 'ops', agentLabel: 'rustybot', organizationEnsName: 'soulvault.eth' })).toBe(
      'rustybot.ops.soulvault.eth',
    );
  });
  it('throws when a piece is missing', async () => {
    const { buildAgentEnsName } = await import('./ensv2-agent-bridge.js');
    expect(() => buildAgentEnsName({ agentLabel: 'x' })).toThrow();
  });
});

describe('registerAgentEnsName', () => {
  beforeEach(() => {
    registerCalls.length = 0;
    textWrites.length = 0;
  });

  it('registers the agent label in the org registry with SET_RESOLVER|RENEW only', async () => {
    const { registerAgentEnsName } = await import('./ensv2-agent-bridge.js');
    const r = await registerAgentEnsName({ swarm: 'ops', agentLabel: 'rustybot' });
    expect(registerCalls).toHaveLength(1);
    expect(r.fullName).toBe('rustybot.ops.soulvault.eth');
    expect(r.registryAddress).toBe('0x0rgR3gistry');
    const [label, owner, subregistry, resolver, roleBitmap] = registerCalls[0].args as [string, string, string, string, bigint];
    expect(label).toBe('rustybot');
    expect(owner).toBe('0x0rg0wner00000000000000000000000000000001');
    expect(subregistry).toBe(ZERO);
    expect(resolver).toBe(ZERO);
    // SET_RESOLVER (1<<24) | RENEW (1<<16) — no UNREGISTER, no SET_SUBREGISTRY
    expect(roleBitmap).toBe((1n << 24n) | (1n << 16n));
  });

  it('mirrors the ERC-8004 identity into resolver records', async () => {
    const { registerAgentEnsName } = await import('./ensv2-agent-bridge.js');
    const r = await registerAgentEnsName({ swarm: 'ops', agentLabel: 'rustybot' });
    expect(r.erc8004).toEqual({ registry: '0x8004', agentId: '7' });
    expect(textWrites.map((w) => w.key)).toEqual(['erc8004.registry', 'erc8004.agentId']);
    expect(textWrites.every((w) => w.name === 'rustybot.ops.soulvault.eth')).toBe(true);
  });

  it('skips record writes when no ERC-8004 identity exists', async () => {
    const saved = agentProfile;
    agentProfile = { name: 'Bare', address: '0xb' };
    const { registerAgentEnsName } = await import('./ensv2-agent-bridge.js');
    const r = await registerAgentEnsName({ swarm: 'ops', agentLabel: 'bare' });
    expect(textWrites).toHaveLength(0);
    expect(r.erc8004).toEqual({ registry: undefined, agentId: undefined });
    agentProfile = saved;
  });

  it('records identity.ensName on the agent profile for reverse lookup', async () => {
    const { registerAgentEnsName } = await import('./ensv2-agent-bridge.js');
    await registerAgentEnsName({ swarm: 'ops', agentLabel: 'rustybot' });
    expect((agentProfile as { identity: { ensName?: string } }).identity.ensName).toBe('rustybot.ops.soulvault.eth');
  });

  it('throws when the org has no deployed registry', async () => {
    const org = await import('./organization.js');
    const saved = vi.mocked(org.getOrganizationProfile);
    // @ts-expect-error test-only override
    vi.spyOn(org, 'getOrganizationProfile').mockResolvedValueOnce({ slug: 'soulvault', ensName: 'soulvault.eth' } as never);
    const { registerAgentEnsName } = await import('./ensv2-agent-bridge.js');
    await expect(registerAgentEnsName({ swarm: 'ops', agentLabel: 'rustybot' })).rejects.toThrow(/deploy-registry/);
    vi.mocked(saved).mockRestore?.();
  });
});

describe('readAgentEnsBridge', () => {
  it('reads the erc8004 pointer records back', async () => {
    const ens = await import('./ens.js');
    vi.mocked(ens.setEnsText).mockImplementation(async () => ({ node: '', key: '', value: '', txHash: undefined }));
    const ensv2 = await import('./ensv2.js');
    // readEnsText is dispatched from ens.js; mock it via the same module's readEnsText
    const { readAgentEnsBridge } = await import('./ensv2-agent-bridge.js');
    // The bridge imports readEnsText from ./ens.js — patch it:
    const mod = await import('./ens.js');
    (mod as unknown as { readEnsText: unknown }).readEnsText = async (name: string, key: string) =>
      key === 'erc8004.registry' ? '0x8004' : key === 'erc8004.agentId' ? '7' : '';
    // Re-import the bridge fresh so its dynamic import picks up the patched fn
    vi.resetModules();
    const bridge = await import('./ensv2-agent-bridge.js');
    const r = await bridge.readAgentEnsBridge({ fullName: 'rustybot.ops.soulvault.eth' });
    expect(r.erc8004).toEqual({ registry: '0x8004', agentId: '7' });
  });
});
