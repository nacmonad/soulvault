import { describe, expect, it } from 'vitest';
import { parseSoulVaultClientConfig } from './client';

const rpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com';

describe('parseSoulVaultClientConfig', () => {
  it('returns null when rpc or deployments is missing', () => {
    expect(parseSoulVaultClientConfig({ rpcUrl })).toBeNull();
    expect(parseSoulVaultClientConfig({ deployments: '[]' })).toBeNull();
  });

  it('returns null for an empty deployments array', () => {
    expect(parseSoulVaultClientConfig({ rpcUrl, deployments: '[]' })).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseSoulVaultClientConfig({ rpcUrl, deployments: '{not json' })).toBeNull();
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
