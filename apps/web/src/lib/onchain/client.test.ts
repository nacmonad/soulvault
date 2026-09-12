import { describe, expect, it } from 'vitest';
import { createSoulVaultPublicClient, parseSoulVaultClientConfig, parseSoulVaultPollSeconds } from './client';

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

describe('createSoulVaultPublicClient', () => {
  it('wraps a comma-separated endpoint list in a round-robin transport with the endpoints on the chain config', () => {
    const client = createSoulVaultPublicClient({
      rpcUrl: 'https://a.example/v3/key,https://b.example',
      chainId: 11155111,
      deployments: [],
    });
    expect((client.transport as unknown as { type: string }).type).toBe('round-robin');
    // The endpoint list stays visible on the chain config (settings UI + debugging).
    expect(client.chain?.rpcUrls.default.http).toEqual(['https://a.example/v3/key', 'https://b.example']);
  });

  it('keeps a single-endpoint client on a plain http transport', () => {
    const client = createSoulVaultPublicClient({ rpcUrl, chainId: 11155111, deployments: [] });
    expect((client.transport as unknown as { type: string }).type).toBe('http');
  });
});

describe('roundRobinTransport rotation', () => {
  it('rotates across endpoints per request and fails over past rate-limited ones', async () => {
    // Fetch is stubbed per-URL: a.example 429s, b.example answers.
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://a.example')) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 429, message: 'Too Many Requests' } }), { status: 429, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const { roundRobinTransport } = await import('./client');
      const transport = roundRobinTransport({ chainId: 11155111, endpoints: ['https://a.example', 'https://b.example'] });
      const t = transport({ chain: undefined, retryCount: 0 });
      // Two requests: whichever endpoint is picked first, both must succeed and
      // the healthy endpoint must serve when the other is rate-limited.
      const r1 = (await t.request({ method: 'eth_blockNumber', params: [] })) as string;
      const r2 = (await t.request({ method: 'eth_blockNumber', params: [] })) as string;
      expect(r1).toBe('0x1');
      expect(r2).toBe('0x1');
      expect(calls.some((u) => u.startsWith('https://b.example'))).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('parseSoulVaultPollSeconds', () => {
  it('defaults to 25s on unset/garbage/too-low values', () => {
    expect(parseSoulVaultPollSeconds(undefined)).toBe(25);
    expect(parseSoulVaultPollSeconds('not-a-number')).toBe(25);
    expect(parseSoulVaultPollSeconds('1')).toBe(25); // floor: 2s minimum
  });

  it('parses valid overrides', () => {
    expect(parseSoulVaultPollSeconds('60')).toBe(60);
    expect(parseSoulVaultPollSeconds('30.9')).toBe(30);
  });
});
