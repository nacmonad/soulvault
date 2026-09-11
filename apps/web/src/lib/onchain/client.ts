/**
 * viem client + config for the browser.
 *
 * Operative contract info (which contracts to listen to) comes from ENS
 * metadata — the org's records plus per-chain singletons announced on the
 * protocol root name — discovered at runtime. `NEXT_PUBLIC_ env vars carry
 * only transport (RPC endpoint, chain id). The legacy build-time deployments
 * JSON list still parses when present (legacy bootstrap), defaulting to [].
 */
import { createPublicClient, http, type Address, type PublicClient, type Transport } from 'viem';
import { sepolia } from 'viem/chains';
import { getRpcUrlOverride, parseRpcUrlList } from '@/lib/rpc-settings';
import type { SoulVaultContractKind, SoulVaultDeployment } from './types';

export type SoulVaultClientConfig = {
  rpcUrl: string;
  chainId: number;
  deployments: SoulVaultDeployment[];
};

export const SOULVAULT_DEFAULT_CHAIN_ID = 11155111;

export function parseSoulVaultClientConfig(input: {
  rpcUrl?: string;
  chainId?: string;
  deployments?: string;
}): SoulVaultClientConfig | null {
  if (!input.rpcUrl) return null;
  // Legacy build-time deployments list: optional bootstrap, never required —
  // event sources are discovered from ENS at runtime instead. A missing,
  // empty, or malformed list parses to [].
  const deployments: SoulVaultDeployment[] = [];
  if (input.deployments) {
    try {
      const raw: unknown = JSON.parse(input.deployments);
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item || typeof item !== 'object') continue;
          const row = item as { address?: Address; kind?: SoulVaultContractKind; fromBlock?: string | number; label?: string };
          if (!row.address || !row.kind || row.fromBlock === undefined) continue;
          deployments.push({ ...row, address: row.address, kind: row.kind, fromBlock: BigInt(row.fromBlock), label: row.label });
        }
      }
    } catch {
      // legacy list is best-effort
    }
  }
  return {
    rpcUrl: input.rpcUrl,
    chainId: Number(input.chainId ?? SOULVAULT_DEFAULT_CHAIN_ID),
    deployments,
  };
}

export function getBrowserSoulVaultClientConfig(): SoulVaultClientConfig | null {
  const envRpc = process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL;
  // Operator override (localStorage, /dashboard/settings) wins over build-time env.
  const rpcUrl = getRpcUrlOverride() ?? envRpc;
  return parseSoulVaultClientConfig({
    rpcUrl,
    chainId: process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID,
    deployments: process.env.NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS,
  });
}

/**
 * Round-robin transport: spreads requests across the provider list instead of
 * viem's fallback behavior (first endpoint wins until it errors — that is why
 * all traffic was hitting publicnode while three other providers sat idle).
 * On error, fails over to the next provider for that request (viem fallback
 * semantics), and a provider that rate-limits is cool-ed down so subsequent
 * requests skip it while the throttle window clears.
 */
export function roundRobinTransport(config: {
  chainId: number;
  endpoints: string[];
}): Transport<'round-robin', Record<string, never>> {
  if (config.endpoints.length === 1) {
    return http(config.endpoints[0], { retryCount: 0 }) as unknown as Transport<'round-robin', Record<string, never>>;
  }
  let next = Math.floor(Math.random() * config.endpoints.length); // random start — page reloads don't all pile on provider 0
  /** Endpoint → until when (epoch ms) it is skipped (rate-limit cool-down). */
  const coolingUntil = new Map<string, number>();

  function pickEndpoint(): string {
    const now = Date.now();
    for (const [url, until] of coolingUntil) {
      if (until <= now) coolingUntil.delete(url);
    }
    for (let i = 0; i < config.endpoints.length; i++) {
      const url = config.endpoints[(next + i) % config.endpoints.length];
      if (!coolingUntil.has(url)) {
        next = (next + i + 1) % config.endpoints.length;
        return url;
      }
    }
    // Every provider is cooling — wait on the one with the soonest recovery.
    const soonest = [...coolingUntil.entries()].sort((a, b) => a[1] - b[1])[0][0];
    return soonest;
  }

  function markRateLimited(url: string, retryAfterMs: number) {
    // Cap the cool-down: a dead endpoint shouldn't ice itself out forever.
    coolingUntil.set(url, Date.now() + Math.min(retryAfterMs, RATE_LIMIT_COOLDOWN_MS));
  }

  const request = async ({ method, params }: { method: string; params?: unknown[] }) => {
    for (let attempt = 0; attempt < config.endpoints.length; attempt++) {
      const url = pickEndpoint();
      const transport = http(url, { retryCount: 0 })({ retryCount: 0 });
      try {
        return await transport.request({ method, params });
      } catch (error) {
        const retryAfterMs = parseTransportRetryAfterMs(error);
        if (retryAfterMs !== null) markRateLimited(url, retryAfterMs);
        // Deterministic errors (revert, user rejection) must not fail over.
        if (fallbackShouldThrow(error)) throw error;
        if (attempt === config.endpoints.length - 1) throw error;
      }
    }
    throw new Error('unreachable');
  };

  // Read-cache wrapper (TTL + in-flight dedupe) — the browser equivalent of
  // what Next.js does server-side. Mount-time event scanning re-reads the
  // same block ranges/blocks through many hooks and effects; without this
  // every redundant read is another public-RPC request (and another 429).
  // Writes and pre-send reads are never cached.
  const requestCached = withReadCache(request);

  // viem's Transport shape: a factory invoked per client with client config,
  // returning { config, request }. The rotation state (next, coolingUntil)
  // lives in this closure, so every client built from this transport shares
  // the same cool-down map — the intended behavior.
  return (() =>
    ({
      config: {
        key: 'round-robin',
        name: 'SoulVault Round Robin',
        type: 'round-robin',
      },
      request: requestCached as never,
    })) as unknown as Transport<'round-robin', Record<string, never>>;
}

const RATE_LIMIT_COOLDOWN_MS = 15_000;

/**
 * TTL + in-flight dedupe for idempotent read methods. Keyed by method+params
 * (provider-agnostic — any healthy endpoint can serve a cache hit). Only
 * safe-for-caching methods are cached; writes, estimates, and nonces never
 * are. Entries are swept lazily on access.
 */
const READ_CACHE_TTL_MS: Record<string, number> = {
  eth_call: 5_000,
  eth_getLogs: 5_000,
  eth_getBlockByNumber: 30_000,
  eth_getBlockByHash: 30_000,
  eth_getTransactionReceipt: 5_000,
  eth_getTransaction: 30_000,
  eth_blockNumber: 3_000,
  eth_chainId: 60_000,
  eth_getBalance: 5_000,
};

/** Module-level so every client built in the page shares one cache. */
const readCache = new Map<string, { value: unknown; expiresAt: number }>();
const inflightReads = new Map<string, Promise<unknown>>();

/** Methods that must NEVER be served from cache (writes + pre-send reads). */
const WRITE_METHODS = new Set([
  'eth_sendRawTransaction',
  'eth_sendTransaction',
  'eth_estimateGas',
  'eth_getTransactionCount',
  'eth_signTypedData_v4',
  'personal_sign',
]);

function withReadCache(request: (args: { method: string; params?: unknown[] }) => Promise<unknown>) {
  return async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (WRITE_METHODS.has(method)) return request({ method, params });
    const ttl = READ_CACHE_TTL_MS[method];
    if (!ttl) return request({ method, params });
    let key: string;
    try {
      key = `${method}:${JSON.stringify(params ?? [])}`;
    } catch {
      return request({ method, params });
    }
    const now = Date.now();
    const cached = readCache.get(key);
    if (cached && cached.expiresAt > now) return cached.value;
    const inflight = inflightReads.get(key);
    if (inflight) return inflight;
    const promise = request({ method, params })
      .then((value) => {
        readCache.set(key, { value, expiresAt: Date.now() + ttl });
        inflightReads.delete(key);
        return value;
      })
      .catch((error) => {
        inflightReads.delete(key); // errors are not cached — retry next time
        throw error;
      });
    inflightReads.set(key, promise);
    return promise;
  };
}

/** Per-method TTLs — WRITE_METHODS short-circuits before this table is consulted. */
const READ_CACHE_TTL = READ_CACHE_TTL_MS;

/** Same semantics as viem's fallback shouldThrow — deterministic errors don't rotate providers. */
function fallbackShouldThrow(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'number') {
    const code = (error as { code: number }).code;
    if (code === 4001 || code === -32000 || code === 5000) return true;
    if (/execution reverted/i.test(String((error as { message?: unknown }).message ?? ''))) return true;
  }
  return false;
}

/** Best-effort Retry-After extraction (header map or error text), in ms. */
function parseTransportRetryAfterMs(error: unknown): number | null {
  if (error && typeof error === 'object') {
    const e = error as { headers?: Record<string, unknown>; message?: string; status?: unknown };
    if (e.status !== 429 && !/429|rate limit|too many/i.test(e.message ?? '')) return null;
    const header = e.headers?.['retry-after'] ?? e.headers?.['Retry-After'];
    if (typeof header === 'string' && /^\d+$/.test(header)) return Number(header) * 1000;
    const match = /retry-after[:\s]+(\d+)/i.exec(e.message ?? '');
    if (match) return Number(match[1]) * 1000;
    return 5000; // 429 without a header — default cool-down
  }
  return null;
}

/**
 * Build the public client. `rpcUrl` may be a comma-separated provider list:
 * one endpoint → plain http transport; several → round-robin across them
 * (per-request rotation with rate-limit cool-downs and failover). Per-endpoint
 * retryCount is 0 so a 429 rotates immediately; retry/backoff policy lives in
 * the getLogs chunker and the watcher tick.
 */
export function createSoulVaultPublicClient(config: SoulVaultClientConfig): PublicClient {
  const urls = parseRpcUrlList(config.rpcUrl);
  const endpoints = urls.length > 0 ? urls : [config.rpcUrl];
  return createPublicClient({
    chain: {
      id: config.chainId,
      name: `SoulVault chain ${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: endpoints } },
    },
    transport: roundRobinTransport({ chainId: config.chainId, endpoints }),
  });
}

/**
 * Public client for viem's high-level ENS actions (getEnsName, getEnsAddress,
 * getEnsResolver, getEnsText). Same provider policy as
 * `createSoulVaultPublicClient`, but built on the real `sepolia` chain object —
 * those actions read the chain's ENS universal-resolver contract addresses,
 * which the synthetic chain above does not carry. Only valid while the
 * identity lane is Sepolia (callers already guard `config.chainId`).
 */
export function createSepoliaEnsClient(config: SoulVaultClientConfig): PublicClient {
  const urls = parseRpcUrlList(config.rpcUrl);
  const endpoints = urls.length > 0 ? urls : [config.rpcUrl];
  return createPublicClient({
    chain: sepolia,
    transport: roundRobinTransport({ chainId: config.chainId, endpoints }),
  });
}
