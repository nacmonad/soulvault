import { describe, expect, it } from 'vitest';
import { parseSoulVaultClientConfig } from './client';

const rpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com';

describe('parseSoulVaultClientConfig', () => {
  it('returns null when rpc is missing', () => {
    expect(parseSoulVaultClientConfig({})).toBeNull();
    expect(parseSoulVaultClientConfig({ deployments: '[]' })).toBeNull();
  });

  it('parses with no deployments at all — event sources are ENS-discovered', () => {
    const config = parseSoulVaultClientConfig({ rpcUrl });
    expect(config).toEqual({ rpcUrl, chainId: 11155111, deployments: [] });
  });

  it('tolerates an empty or malformed legacy deployments list', () => {
    expect(parseSoulVaultClientConfig({ rpcUrl, deployments: '[]' })?.deployments).toEqual([]);
    expect(parseSoulVaultClientConfig({ rpcUrl, deployments: '{not json' })?.deployments).toEqual([]);
  });

  it('skips invalid rows but keeps valid ones', () => {
    const config = parseSoulVaultClientConfig({
      rpcUrl,
      chainId: '11155111',
      deployments: JSON.stringify([
        { kind: 'document', address: '0x00000000000000000000000000000000000000a1' },
        {
          kind: 'document',
          address: '0x00000000000000000000000000000000000000a2',
          fromBlock: '123',
          label: 'docs',
        },
      ]),
    });
    expect(config).not.toBeNull();
    expect(config?.chainId).toBe(11155111);
    expect(config?.deployments).toHaveLength(1);
    expect(config?.deployments[0].fromBlock).toBe(123n);
    expect(config?.deployments[0].address).toBe('0x00000000000000000000000000000000000000a2');
    expect(config?.deployments[0].kind).toBe('document');
  });

  it('parses a non-empty deployment list', () => {
    const config = parseSoulVaultClientConfig({
      rpcUrl,
      chainId: '11155111',
      deployments: JSON.stringify([
        {
          kind: 'document',
          address: '0x00000000000000000000000000000000000000a1',
          fromBlock: '123',
          label: 'docs',
        },
      ]),
    });
    expect(config).not.toBeNull();
    expect(config?.chainId).toBe(11155111);
    expect(config?.deployments).toHaveLength(1);
    expect(config?.deployments[0].fromBlock).toBe(123n);
    expect(config?.deployments[0].kind).toBe('document');
  });
});
