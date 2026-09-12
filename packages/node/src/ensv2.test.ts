import { beforeEach, describe, expect, it, vi } from 'vitest';
import { labelhash as viemLabelhash } from 'viem/ens';

/**
 * Unit tests for ENSv2 dispatch + pure helpers. Network-free: the ethers Contract
 * layer and the provider/signer factories are mocked so both the v1 fallback path
 * and the v2 dispatch paths run against canned returns. Live Sepolia behavior is
 * covered separately by scripts/ensv2-smoke.ts (needs RPC).
 */

const mockReturns = new Map<string, (...args: unknown[]) => Promise<unknown>>();

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    target: string;
    abi: unknown;
    constructor(target: string, abi: unknown, _runner?: unknown) {
      this.target = target;
      this.abi = abi;
      return new Proxy(this, {
        get: (t, prop: string | symbol) => {
          if (typeof prop !== 'string' || prop in t) return Reflect.get(t, prop);
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined; // never thenable
          return (...args: unknown[]) => {
            const fn = mockReturns.get(prop);
            if (!fn) return Promise.reject(new Error(`ensv2.test: no canned return for method "${prop}"`));
            return Promise.resolve(fn(...args));
          };
        },
      });
    }
  }
  return { ...actual, Contract: MockContract as unknown };
});

vi.mock('./provider.js', () => ({
  createJsonRpcProvider: async () => ({}),
}));

vi.mock('./signer.js', () => ({
  createSignerForProvider: async () => ({}),
}));

const ZERO = '0x0000000000000000000000000000000000000000';
const ROOT = '0x8115186e8f2e0b0281e86ab91f0f48ba90364354';

function setV2Flag(on: boolean) {
  if (on) {
    process.env.SOULVAULT_ENSV2 = '1';
    process.env.SOULVAULT_ENSV2_ROOT_REGISTRY_ADDRESS = ROOT;
  } else {
    delete process.env.SOULVAULT_ENSV2;
    delete process.env.SOULVAULT_ENSV2_ROOT_REGISTRY_ADDRESS;
  }
}

describe('ensv2 pure helpers', () => {
  it('splitEnsLabels splits TLD-last and filters empties', async () => {
    const { splitEnsLabels } = await import('./ensv2.js');
    expect(splitEnsLabels('ops.foo.eth')).toEqual(['ops', 'foo', 'eth']);
    expect(splitEnsLabels('.foo.eth')).toEqual(['foo', 'eth']);
    expect(splitEnsLabels('')).toEqual([]);
  });

  it('walkEnsV2Registry walks TLD-first and reports unresolved labels in name order', async () => {
    setV2Flag(true);
    // root.getSubregistry('eth') → subregistry; subregistry.getSubregistry('foo') → zero
    let calls = 0;
    mockReturns.set('getSubregistry', async (label: string) => {
      calls++;
      return label === 'eth' ? '0x2222222222222222222222222222222222222222' : ZERO;
    });
    const { walkEnsV2Registry } = await import('./ensv2.js');
    const walk = await walkEnsV2Registry('foo.eth');
    expect(calls).toBe(2);
    expect(walk.resolvedLabels).toEqual(['eth']);
    expect(walk.unresolvedLabels).toEqual(['eth', 'foo']);
    expect(walk.registryAddress).toBe('0x2222222222222222222222222222222222222222');
    setV2Flag(false);
    mockReturns.clear();
  });

  it('ENSV2_ROLES match RegistryRolesLib nybble packing', async () => {
    const { ENSV2_ROLES } = await import('./ensv2.js');
    expect(ENSV2_ROLES.ROLE_REGISTRAR).toBe(1n << 0n);
    expect(ENSV2_ROLES.ROLE_SET_RESOLVER).toBe(1n << 24n);
    expect(ENSV2_ROLES.ROLE_SET_SUBREGISTRY).toBe(1n << 20n);
  });

  it('isEnsV2Enabled requires flag AND root registry address', async () => {
    const { isEnsV2Enabled } = await import('./ensv2.js');
    setV2Flag(false);
    expect(isEnsV2Enabled()).toBe(false);
    process.env.SOULVAULT_ENSV2 = '1';
    expect(isEnsV2Enabled()).toBe(false); // flag without address
    setV2Flag(true);
    expect(isEnsV2Enabled()).toBe(true);
    setV2Flag(false);
  });
});

describe('ens.ts dispatch (mock provider layer)', () => {
  beforeEach(() => {
    mockReturns.clear();
    setV2Flag(false);
  });

  it('readEnsNodeOwner returns v1 registry.owner result when flag off', async () => {
    mockReturns.set('owner', async () => '0x1111111111111111111111111111111111111111');
    const { readEnsNodeOwner } = await import('./ens.js');
    const r = await readEnsNodeOwner('foo.eth');
    expect(r.owner).toBe('0x1111111111111111111111111111111111111111');
  });

  it('readEnsNodeOwner dispatches to v2 getState().latestOwner when flag on', async () => {
    setV2Flag(true);
    // foo.eth fully "registered": root --eth--> ETHRegistry (0x2222…),
    // 0x2222… --foo--> foo's own subregistry (0x6666…). getState is called on
    // the HOLDING registry (ETHRegistry — the parent walk end), keyed by
    // labelhash('foo').
    mockReturns.set('getSubregistry', async (label: string) =>
      label === 'eth' ? '0x2222222222222222222222222222222222222222' : '0x6666666666666666666666666666666666666666',
    );
    mockReturns.set('getState', async (anyId: bigint) => {
      expect(anyId).toBe(BigInt(viemLabelhash('foo'))); // labelhash('foo') — the token id key in the holding registry
      return [2, 9999999999n, '0x3333333333333333333333333333333333333333', 123n, 456n];
    });
    const { readEnsNodeOwner } = await import('./ens.js');
    const r = await readEnsNodeOwner('foo.eth');
    expect(r.owner).toBe('0x3333333333333333333333333333333333333333');
  });

  it('readEnsNodeOwner v2 unregistered name → zero owner (parity with v1)', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async () => ZERO);
    const { readEnsNodeOwner } = await import('./ens.js');
    const r = await readEnsNodeOwner('foo.eth');
    expect(r.owner).toBe(ZERO);
  });

  it('readEnsText v2 dispatch: resolver from hierarchy walk, text read through it', async () => {
    setV2Flag(true);
    // foo.eth fully "registered": root --eth--> 0x2222…, 0x2222… --foo--> 0x6666…
    // (the name's own subregistry). Resolver for foo.eth is read ONE LEVEL UP:
    // ETHRegistry.getResolver('foo'). readEnsText also runs the owner dispatch
    // (readEnsV2NameState), so getState needs a canned REGISTERED return.
    mockReturns.set('getSubregistry', async (label: string) =>
      label === 'eth' ? '0x2222222222222222222222222222222222222222' : '0x6666666666666666666666666666666666666666',
    );
    mockReturns.set('getState', async () => [2, 9999999999n, '0x3333333333333333333333333333333333333333', 123n, 456n]);
    mockReturns.set('getResolver', async () => '0x4444444444444444444444444444444444444444');
    mockReturns.set('text', async (_node: string, key: string) =>
      key === 'soulvault.swarmContract' ? '0x5555555555555555555555555555555555555555' : '',
    );
    const { readEnsText } = await import('./ens.js');
    const v = await readEnsText('foo.eth', 'soulvault.swarmContract');
    expect(v).toBe('0x5555555555555555555555555555555555555555');
  });

  it('readEnsText v2 with no resolver → empty string, no throw', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async () => ZERO);
    const { readEnsText } = await import('./ens.js');
    expect(await readEnsText('foo.eth', 'anything')).toBe('');
  });

  it('setEnsText v2 dispatch: setText lands on the hierarchy-resolved resolver', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async (label: string) =>
      label === 'eth' ? '0x2222222222222222222222222222222222222222' : '0x6666666666666666666666666666666666666666',
    );
    mockReturns.set('getState', async () => [2, 9999999999n, '0x3333333333333333333333333333333333333333', 123n, 456n]);
    mockReturns.set('getResolver', async () => '0x4444444444444444444444444444444444444444');
    let setTextArgs: unknown[] | null = null;
    mockReturns.set('setText', async (...args: unknown[]) => {
      setTextArgs = args;
      return { wait: async () => ({ hash: '0xdeadbeef' }) };
    });
    const { setEnsText } = await import('./ens.js');
    const r = await setEnsText('foo.eth', 'soulvault.chainId', '11155111');
    expect(setTextArgs).toBeTruthy();
    expect(r.txHash).toBe('0xdeadbeef');
    expect(r.key).toBe('soulvault.chainId');
    setV2Flag(false);
  });

  it('setEnsText v2 with no resolver → throws with register guidance', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async () => ZERO);
    const { setEnsText } = await import('./ens.js');
    await expect(setEnsText('foo.eth', 'k', 'v')).rejects.toThrow(/no v2 resolver/i);
    setV2Flag(false);
  });

  it('getAddrMultichain v2 dispatch: ENSIP-11 read via hierarchy-resolved resolver', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async (label: string) =>
      label === 'eth' ? '0x2222222222222222222222222222222222222222' : '0x6666666666666666666666666666666666666666',
    );
    mockReturns.set('getState', async () => [2, 9999999999n, '0x3333333333333333333333333333333333333333', 123n, 456n]);
    mockReturns.set('getResolver', async () => '0x4444444444444444444444444444444444444444');
    const expectedCoinType = BigInt((0x80000000 | 11155111) >>> 0);
    let sawCoinType: bigint | null = null;
    mockReturns.set('addr', async (_node: string, coinType: bigint) => {
      sawCoinType = coinType;
      return '0x5555555555555555555555555555555555555555';
    });
    const { getAddrMultichain } = await import('./ens.js');
    const a = await getAddrMultichain('foo.eth', 11155111);
    expect(Number(sawCoinType)).toBe((0x80000000 | 11155111) >>> 0);
    expect(a?.toLowerCase()).toBe('0x5555555555555555555555555555555555555555');
    setV2Flag(false);
  });

  it('setAddrMultichain v2 dispatch: setAddr lands on the hierarchy-resolved resolver', async () => {
    setV2Flag(true);
    mockReturns.set('getSubregistry', async (label: string) =>
      label === 'eth' ? '0x2222222222222222222222222222222222222222' : '0x6666666666666666666666666666666666666666',
    );
    mockReturns.set('getState', async () => [2, 9999999999n, '0x3333333333333333333333333333333333333333', 123n, 456n]);
    mockReturns.set('getResolver', async () => '0x4444444444444444444444444444444444444444');
    let setAddrArgs: unknown[] | null = null;
    mockReturns.set('setAddr', async (...args: unknown[]) => {
      setAddrArgs = args;
      return { wait: async () => ({ hash: '0xfeedface' }) };
    });
    const { setAddrMultichain } = await import('./ens.js');
    const r = await setAddrMultichain('foo.eth', 11155111, '0x5555555555555555555555555555555555555555');
    expect(setAddrArgs).toBeTruthy();
    expect(r.txHash).toBe('0xfeedface');
    expect(r.coinType).toBe((0x80000000 | 11155111) >>> 0);
    setV2Flag(false);
  });
});
