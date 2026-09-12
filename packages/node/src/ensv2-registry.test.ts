import { beforeEach, describe, expect, it, vi } from 'vitest';
import { labelhash as viemLabelhash } from 'viem/ens';

/**
 * Unit tests for ensv2-registry.ts — network-free. The ethers Contract layer and
 * signer/provider factories are mocked so the deployment + registration logic
 * (salt handling, initData encoding, role constants, state parsing) runs against
 * canned returns. Live behavior is the forge spike (contracts/ensv2/, 6/6) plus
 * eventual Sepolia smoke.
 */

const mockReturns = new Map<string, (...args: unknown[]) => Promise<unknown>>();
const deployedContracts: Array<{ target: string; calls: Array<{ method: string; args: unknown[] }> }> = [];

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  class MockContract {
    target: string;
    interface: { encodeFunctionData: (name: string, args: unknown[]) => string };
    calls: Array<{ method: string; args: unknown[] }> = [];
    constructor(target: string, _abi: unknown, _runner?: unknown) {
      this.target = String(target);
      this.interface = {
        encodeFunctionData: (name: string, args: unknown[]) =>
          `0xinitdata(${name}(${args.join(',')}))`,
      };
      deployedContracts.push(this as never);
      return new Proxy(this, {
        get: (t, prop: string | symbol) => {
          if (typeof prop !== 'string' || prop in t) return Reflect.get(t, prop);
          if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;
          return (...args: unknown[]) => {
            this.calls.push({ method: prop, args });
            const fn = mockReturns.get(prop);
            if (!fn) return Promise.reject(new Error(`ensv2-registry.test: no canned return for "${prop}"`));
            return Promise.resolve(fn(...args));
          };
        },
      });
    }
  }
  return { ...actual, Contract: MockContract as unknown, ContractFactory: MockContractFactory as unknown };
});

// Deployed-artifact addresses handed out by the ContractFactory mock, in deploy order.
const factoryDeployAddresses = ['0xFaCt0ry000000000000000000000000000000001', '0xFaCt0ry000000000000000000000000000000002'];
let factoryDeployCount = 0;

class MockContractFactory {
  constructor(_abi: unknown, _bytecode: string, _signer?: unknown) {}
  async deploy(..._args: unknown[]) {
    const address = factoryDeployAddresses[factoryDeployCount++ % factoryDeployAddresses.length];
    return {
      getAddress: async () => address,
      waitForDeployment: async () => {},
      deploymentTransaction: () => ({ hash: '0xfactorydeploy' }),
    };
  }
}

vi.mock('./signer.js', () => ({
  createSigner: async () => ({ address: '0x9999999999999999999999999999999999999999' }),
}));

vi.mock('./ens.js', () => ({
  createEnsSigner: async () => ({ address: '0xA11CE00000000000000000000000000000000001' }),
  createEnsProvider: async () => ({}),
}));

vi.mock('./ensv2.js', () => ({
  getEnsV2Provider: async () => ({}),
}));

const ZERO = '0x0000000000000000000000000000000000000000';
const PROXY = '0xP0xy000000000000000000000000000000000000'.replace(/[^0-9a-fA-Fx]/g, '0');
const OWNER = '0xA11CE00000000000000000000000000000000001';

function setTxReturns() {
  // deployProxy returns a tx whose wait() yields a receipt with one log from the proxy.
  mockReturns.set('deployProxy', async () => ({
    wait: async () => ({ hash: '0xdeploytx', logs: [{ address: PROXY }] }),
  }));
  // register returns a tx handle; getState returns a REGISTERED state tuple.
  mockReturns.set('register', async () => ({ wait: async () => ({ hash: '0xregistertx' }) }));
  mockReturns.set('renew', async () => ({ wait: async () => ({ hash: '0xrenewtx' }) }));
  mockReturns.set('grantRoles', async () => ({ wait: async () => ({ hash: '0xgranttx' }) }));
  mockReturns.set(
    'getState',
    async () => [2, 1893456000n, OWNER, 777n, 0xabcn],
  );
  mockReturns.set('hasRoles', async () => true);
  mockReturns.set('roles', async () => (1n << 24n) | (1n << 16n));
}

describe('ensv2-registry constants', () => {
  it('EAC_ALL_ROLES matches EACBaseRolesLib.ALL_ROLES (bit 0 in every nybble)', async () => {
    const { EAC_ALL_ROLES } = await import('./ensv2-registry.js');
    expect(EAC_ALL_ROLES).toBe(0x1111111111111111111111111111111111111111111111111111111111111111n);
  });

  it('SWARM_NAME_ROLES = SET_RESOLVER | RENEW, never UNREGISTER', async () => {
    const { SWARM_NAME_ROLES, REGISTRY_ROLES } = await import('./ensv2-registry.js');
    expect(SWARM_NAME_ROLES).toBe(REGISTRY_ROLES.ROLE_SET_RESOLVER | REGISTRY_ROLES.ROLE_RENEW);
    expect(SWARM_NAME_ROLES & REGISTRY_ROLES.ROLE_UNREGISTER).toBe(0n);
  });
});

describe('deployEnsV2OrgRegistry', () => {
  beforeEach(() => {
    mockReturns.clear();
    deployedContracts.length = 0;
    setTxReturns();
  });

  it('deploys LabelStore + UserRegistry impl, then a proxy initialized with ALL roles for the signer', async () => {
    const { deployEnsV2OrgRegistry, EAC_ALL_ROLES } = await import('./ensv2-registry.js');
    const result = await deployEnsV2OrgRegistry({});

    // initData binds the SIGNER (org owner) to ALL_ROLES on root — the spike's
    // initialize(orgOwner, EACBaseRolesLib.ALL_ROLES) in TypeScript form.
    const impl = deployedContracts.find((c) => c.calls.some((k) => k.method === 'deployProxy'));
    expect(impl).toBeTruthy();
    const proxyCall = impl!.calls.find((k) => k.method === 'deployProxy')!;
    // deployProxy(implementation, salt, initData) — arg 1 = salt (0x5011 default),
    // arg 2 = initData referencing initialize + ALL_ROLES
    expect(String(proxyCall.args[2])).toContain('initialize');
    // BigInt joins as decimal in the mock's encodeFunctionData stub
    expect(String(proxyCall.args[2])).toContain(EAC_ALL_ROLES.toString());
    // Proxy address parsed from the receipt log + root role sanity check ran
    expect(result.registryAddress).toBe(PROXY);
    expect(result.owner).toBe(OWNER);
    expect(result.txHash).toBe('0xdeploytx');
    expect(mockReturns.has('hasRoles')).toBe(true); // post-deploy verification ran
  });

  it('honors an explicit salt override', async () => {
    const { deployEnsV2OrgRegistry } = await import('./ensv2-registry.js');
    await deployEnsV2OrgRegistry({ salt: 0xdeadn });
    const impl = deployedContracts.find((c) => c.calls.some((k) => k.method === 'deployProxy'));
    expect(impl!.calls.find((k) => k.method === 'deployProxy')!.args[1]).toBe(0xdeadn);
  });
});

describe('registerEnsV2Subname', () => {
  beforeEach(() => {
    mockReturns.clear();
    deployedContracts.length = 0;
    setTxReturns();
  });

  it('registers with epoch expiry + swarm roles, then reads back state', async () => {
    const { registerEnsV2Subname, SWARM_NAME_ROLES } = await import('./ensv2-registry.js');
    const result = await registerEnsV2Subname({
      registryAddress: PROXY,
      label: 'ops',
      expirySeconds: 30 * 86400,
    });
    const registry = deployedContracts.find((c) => c.target === PROXY)!;
    const reg = registry.calls.find((k) => k.method === 'register')!;
    // register(label, owner, subregistry=0x0, resolver=0x0, roleBitmap, expiry)
    expect(reg.args[0]).toBe('ops');
    expect(reg.args[1]).toBe(OWNER); // default owner = active signer
    expect(reg.args[2]).toBe(ZERO);
    expect(reg.args[3]).toBe(ZERO);
    expect(reg.args[4]).toBe(SWARM_NAME_ROLES);
    expect(Number(reg.args[5])).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // State read-back: anyId = labelhash(label), parsed into the result shape
    expect(result.anyId).toBe(BigInt(viemLabelhash('ops')).toString());
    expect(result.status).toBe(2);
    expect(result.latestOwner).toBe(OWNER);
    expect(result.resource).toBe(BigInt(0xabcn).toString());
    expect(result.txHash).toBe('0xregistertx');
  });

  it('readEnsV2Roles keys roles() by the name resource and returns the bitmap', async () => {
    const { readEnsV2Roles } = await import('./ensv2-registry.js');
    const r = await readEnsV2Roles({ registryAddress: PROXY, label: 'ops', account: OWNER });
    expect(r.roleBitmap).toBe((1n << 24n) | (1n << 16n));
    expect(r.resource).toBe(0xabcn);
    expect(r.latestOwner).toBe(OWNER);
  });

  it('grantEnsV2Roles grants by anyId (labelhash), not resource', async () => {
    mockReturns.set('grantRoles', async () => ({ wait: async () => ({ hash: '0xgranttx' }) }));
    const { grantEnsV2Roles } = await import('./ensv2-registry.js');
    const r = await grantEnsV2Roles({
      registryAddress: PROXY,
      label: 'ops',
      roleBitmap: 1n << 24n,
      account: '0xB0B0000000000000000000000000000000000000',
    });
    const registry = deployedContracts.find((c) => c.target === PROXY)!;
    const grant = registry.calls.find((k) => k.method === 'grantRoles')!;
    expect(grant.args[0]).toBe(BigInt(viemLabelhash('ops'))); // anyId-keyed, per the spike
    expect(r.txHash).toBe('0xgranttx');
  });
});
