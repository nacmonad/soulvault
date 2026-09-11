import { beforeEach, describe, expect, it, vi } from 'vitest';
import { labelhash as viemLabelhash } from 'viem/ens';

/**
 * Unit tests for ensv2-grants.ts (Phase 3 EAC wiring) — network-free. The v2
 * hierarchy read (readEnsV2NameState) and ethers Contract are mocked; live
 * behavior rides the forge spike semantics (anyId-keyed grants, EAC scoping).
 */

const mockReturns = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const contractCalls: Array<{ target: string; method: string; args: unknown[] }> = [];

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    constructor(target: string, _abi: unknown, _runner?: unknown) {
      return new Proxy(this, {
        get: (_t, prop: string | symbol) => {
          if (typeof prop !== 'string' || prop === 'then' || prop === 'catch' || prop === 'finally') {
            return undefined;
          }
          return (...args: unknown[]) => {
            contractCalls.push({ target: String(target), method: prop, args });
            const fn = mockReturns.get(prop);
            if (!fn) return Promise.reject(new Error(`no canned return for "${prop}"`));
            return Promise.resolve(fn(...args));
          };
        },
      }) as unknown;
    }
  }
  return { ...actual, Contract: MockContract as unknown };
});

vi.mock('./ens.js', () => ({
  createEnsSigner: async () => ({ address: '0x0wner000000000000000000000000000000000001' }),
  setEnsText: async (name: string, key: string, value: string) => ({ name, key, value, txHash: '0xsettext' }),
}));

const NAME_STATE = {
  status: 2,
  expiry: 1893456000,
  latestOwner: '0x0wner000000000000000000000000000000000001',
  tokenId: 777n,
  resource: 0xabcn,
  registryAddress: '0xRegi5try00000000000000000000000000000001',
};

vi.mock('./ensv2.js', () => ({
  getEnsV2Provider: async () => ({}),
  readEnsV2NameState: async (fullName: string) =>
    fullName === 'ops.soulvault.eth' ? { ...NAME_STATE } : null,
  // Stateful role ledger: grants add, revokes clear — so post-tx verification
  // in grantEnsV2RoleByName/revokeEnsV2RoleByName behaves like the chain.
  hasEnsV2Roles: vi.fn(async (_fullName: string, bitmap: bigint, account: string) => {
    const held = roleState.get(account) ?? 0n;
    return (held & bitmap) === bitmap && held !== 0n;
  }),
}));

/** Mutable per-account role bitmaps the mock contracts mutate via grant/revoke. */
const roleState = new Map<string, bigint>();

const AGENT = '0xAgeNt0000000000000000000000000000000002';
const OTHER = '0x0ther00000000000000000000000000000000003';

function setTxReturns() {
  roleState.clear();
  mockReturns.set(
    'grantRoles',
    async (_anyId: unknown, bitmap: bigint, account: string) => {
      roleState.set(account, (roleState.get(account) ?? 0n) | bitmap);
      return { wait: async () => ({ hash: '0xgranttx' }) };
    },
  );
  mockReturns.set(
    'revokeRoles',
    async (_anyId: unknown, bitmap: bigint, account: string) => {
      roleState.set(account, (roleState.get(account) ?? 0n) & ~bitmap);
      return { wait: async () => ({ hash: '0xrevoketx' }) };
    },
  );
  mockReturns.set('roles', async (_resource: bigint, account: string) => roleState.get(account) ?? 0n);
}

describe('parseEnsV2RoleBitmap / formatEnsV2RoleBitmap', () => {
  it('parses comma-separated role names into a nybble-packed bitmap', async () => {
    const { parseEnsV2RoleBitmap } = await import('./ensv2-grants.js');
    expect(parseEnsV2RoleBitmap('set-resolver,renew')).toBe((1n << 24n) | (1n << 16n));
    expect(parseEnsV2RoleBitmap(' registrar ')).toBe(1n << 0n);
    expect(parseEnsV2RoleBitmap('SET-RESOLVER')).toBe(1n << 24n); // case-insensitive
  });

  it('rejects unknown roles and empty specs with actionable errors', async () => {
    const { parseEnsV2RoleBitmap } = await import('./ensv2-grants.js');
    expect(() => parseEnsV2RoleBitmap('superuser')).toThrow(/Unknown ENSv2 role/);
    expect(() => parseEnsV2RoleBitmap('')).toThrow(/Empty role bitmap/);
  });

  it('format round-trips the parsed bitmap', async () => {
    const { parseEnsV2RoleBitmap, formatEnsV2RoleBitmap } = await import('./ensv2-grants.js');
    const bmp = parseEnsV2RoleBitmap('set-resolver,renew');
    expect(formatEnsV2RoleBitmap(bmp).sort()).toEqual(['renew', 'set-resolver']);
  });
});

describe('grantEnsV2RoleByName', () => {
  beforeEach(() => {
    mockReturns.clear();
    contractCalls.length = 0;
    setTxReturns();
  });

  it('grants on the name registry keyed by labelhash(anyId) and verifies post-grant', async () => {
    const { grantEnsV2RoleByName } = await import('./ensv2-grants.js');
    const result = await grantEnsV2RoleByName({
      fullName: 'ops.soulvault.eth',
      roleSpec: 'set-resolver',
      account: AGENT,
    });
    const grant = contractCalls.find((c) => c.method === 'grantRoles')!;
    expect(grant.target).toBe(NAME_STATE.registryAddress);
    expect(grant.args[0]).toBe(BigInt(viemLabelhash('ops'))); // anyId = label of the name
    expect(grant.args[1]).toBe(1n << 24n);
    expect(grant.args[2]).toBe(AGENT);
    expect(result.roles).toEqual(['set-resolver']);
    expect(result.resource).toBe(NAME_STATE.resource.toString());
    expect(result.txHash).toBe('0xgranttx');
  });

  it('refuses when the name is unregistered', async () => {
    const { grantEnsV2RoleByName } = await import('./ensv2-grants.js');
    await expect(
      grantEnsV2RoleByName({ fullName: 'ghost.soulvault.eth', roleSpec: 'renew', account: AGENT }),
    ).rejects.toThrow(/not registered on ENSv2/);
  });
});

describe('revokeEnsV2RoleByName', () => {
  beforeEach(() => {
    mockReturns.clear();
    contractCalls.length = 0;
    setTxReturns();
  });

  it('revokes keyed by anyId and verifies the roles are gone', async () => {
    const { revokeEnsV2RoleByName } = await import('./ensv2-grants.js');
    const result = await revokeEnsV2RoleByName({
      fullName: 'ops.soulvault.eth',
      roleSpec: 'set-resolver',
      account: AGENT,
    });
    const revoke = contractCalls.find((c) => c.method === 'revokeRoles')!;
    expect(revoke.args[0]).toBe(BigInt(viemLabelhash('ops')));
    expect(result.txHash).toBe('0xrevoketx');
  });

  it('fails loudly when revocation did not take effect', async () => {
    // Force the post-tx verification to report the roles as still held.
    const ensv2 = await import('./ensv2.js');
    vi.mocked(ensv2.hasEnsV2Roles).mockResolvedValueOnce(true);
    const { revokeEnsV2RoleByName } = await import('./ensv2-grants.js');
    await expect(
      revokeEnsV2RoleByName({ fullName: 'ops.soulvault.eth', roleSpec: 'set-resolver', account: AGENT }),
    ).rejects.toThrow(/STILL holds/);
  });
});

describe('readEnsV2RolesByName', () => {
  beforeEach(() => {
    mockReturns.clear();
    contractCalls.length = 0;
    setTxReturns();
  });

  it('decodes the bitmap into role names keyed by the name resource', async () => {
    roleState.set(AGENT, (1n << 24n) | (1n << 16n));
    const { readEnsV2RolesByName } = await import('./ensv2-grants.js');
    const r = await readEnsV2RolesByName({ fullName: 'ops.soulvault.eth', account: AGENT });
    const roles = contractCalls.find((c) => c.method === 'roles')!;
    expect(roles.args[0]).toBe(NAME_STATE.resource); // resource-keyed read
    expect(roles.args[1]).toBe(AGENT);
    expect(r!.roles.sort()).toEqual(['renew', 'set-resolver']);
    expect(r!.status).toBe(2);
  });

  it('returns null for unregistered names', async () => {
    const { readEnsV2RolesByName } = await import('./ensv2-grants.js');
    expect(await readEnsV2RolesByName({ fullName: 'ghost.soulvault.eth', account: AGENT })).toBeNull();
  });
});

describe('setEnsV2TextScoped', () => {
  beforeEach(() => {
    mockReturns.clear();
    contractCalls.length = 0;
    setTxReturns();
  });

  it('writes when the signer holds ROLE_SET_RESOLVER', async () => {
    roleState.set(AGENT, 1n << 24n);
    const { setEnsV2TextScoped } = await import('./ensv2-grants.js');
    const r = await setEnsV2TextScoped({
      fullName: 'ops.soulvault.eth',
      key: 'soulvault.status',
      value: 'healthy',
      signerAddress: AGENT,
    });
    expect(r.txHash).toBe('0xsettext');
  });

  it('blocks with an actionable error when the signer lacks the role', async () => {
    const { setEnsV2TextScoped } = await import('./ensv2-grants.js');
    await expect(
      setEnsV2TextScoped({
        fullName: 'ops.soulvault.eth',
        key: 'soulvault.status',
        value: 'healthy',
        signerAddress: OTHER,
      }),
    ).rejects.toThrow(/lacks ROLE_SET_RESOLVER[\s\S]*ens grant/);
  });
});
