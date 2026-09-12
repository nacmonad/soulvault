import { decodeEventLog, isAddressEqual, type Address, type Hex, type Log, type PublicClient } from "viem";
import { SOULVAULT_EVENT_ABIS } from "./abis";
import {
  createSoulVaultPublicClient,
  type SoulVaultClientConfig,
} from "./client";
import type { SoulVaultContractKind, SoulVaultDeployment } from "./types";

export type { SoulVaultContractKind, SoulVaultDeployment };
export {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig as getBrowserSoulVaultActivityConfig,
  parseSoulVaultClientConfig as parseSoulVaultActivityConfig,
  type SoulVaultClientConfig,
} from "./client";

export type SoulVaultContractKindLegacy = SoulVaultContractKind;
export type SoulVaultActivity = {
  contract: Address; contractKind: SoulVaultContractKind; contractLabel?: string;
  eventName: string; args: Record<string, unknown>; blockNumber: bigint;
  logIndex: number; transactionHash: Hex;
  relationship: "initiated" | "referenced" | "initiated-and-referenced";
};

/** Public-node eth_getLogs block-range cap (publicnode = 50_000; keep headroom). */
export const GET_LOGS_MAX_RANGE = 40_000n;

const CHUNK_PACE_MS = 400;
/** Concurrent getLogs slice fetches. Public providers throttle aggressively
 * (publicnode 429s compound across workers — seen live); 2 workers + 400ms
 * pacing keeps a ~1M-block source under the rate ceiling while staying
 * ~sequential-safe. 429s are absorbed by the per-chunk backoff and (with a
 * multi-provider list) by failover. */
const CHUNK_CONCURRENCY = 2;
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_PATTERN = /rate limit|429|too many/i;

/** Providers announce their getLogs range cap in the error text — Infura:
 * "range 1082183 exceeds limit of 10000"; others phrase it "limited to N".
 * These are deterministic: retrying the same range never helps, shrinking does. */
const RANGE_LIMIT_PATTERNS = [/exceeds limit of (\d+)/i, /limit(?:ed)? to (\d+)/i];

/** Learned per-client range caps — a provider's cap is stable, so once a client
 * reveals it, later scans skip the failed-probe cost. WeakMap so per-test mock
 * clients (and discarded clients) neither share nor leak the learned value. */
const learnedRangeByClient = new WeakMap<object, bigint>();

export function parseGetLogsRangeLimit(error: unknown): bigint | null {
  const message = error instanceof Error ? error.message : String(error);
  for (const pattern of RANGE_LIMIT_PATTERNS) {
    const match = pattern.exec(message);
    if (match) {
      const limit = BigInt(match[1]);
      if (limit > 0n) return limit;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Public RPCs commonly cap eth_getLogs block ranges (publicnode: 50_000,
 * Infura: 10_000) and rate-limit request bursts. Fetch in bounded slices with
 * bounded concurrency and pacing, retrying rate-limited slices with
 * exponential backoff. When a provider rejects a slice for exceeding its range
 * cap, the cap is learned (per client) and the scan is rebuilt at that width.
 * Tolerates clients without getBlockNumber by falling back to a single
 * unchunked call.
 */
export async function getLogsChunked(
  client: Pick<PublicClient, 'getLogs' | 'getBlockNumber'>,
  input: { address: Address; fromBlock: bigint; toBlock: bigint | 'latest' },
): Promise<Log[]> {
  let target: bigint | 'latest' = input.toBlock;
  if (target === 'latest') {
    try {
      target = await client.getBlockNumber();
    } catch {
      return client.getLogs({ address: input.address, fromBlock: input.fromBlock, toBlock: 'latest' });
    }
  }
  if (target < input.fromBlock) return [];
  let range = learnedRangeByClient.get(client) ?? GET_LOGS_MAX_RANGE;
  for (;;) {
    const chunks: Array<{ address: Address; fromBlock: bigint; toBlock: bigint }> = [];
    for (let start = input.fromBlock; start <= target; start += range) {
      const end = start + range - BigInt(1) > target ? target : start + range - BigInt(1);
      chunks.push({ address: input.address, fromBlock: start, toBlock: end });
    }
    try {
      return await fetchChunksWithConcurrency(client, chunks);
    } catch (error) {
      const limit = parseGetLogsRangeLimit(error);
      if (limit === null || limit >= range) throw error;
      // Cap revealed — rebuild the whole scan at the narrower width.
      range = limit;
      learnedRangeByClient.set(client, limit);
    }
  }
}

async function fetchChunksWithConcurrency(
  client: Pick<PublicClient, 'getLogs'>,
  chunks: Array<{ address: Address; fromBlock: bigint; toBlock: bigint }>,
): Promise<Log[]> {
  const results: Log[][] = new Array(chunks.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= chunks.length) return;
      if (index > 0) await sleep(CHUNK_PACE_MS);
      results[index] = await fetchChunkWithRetry(client, chunks[index]);
    }
  });
  await Promise.all(workers);
  return results.flat();
}

async function fetchChunkWithRetry(
  client: Pick<PublicClient, 'getLogs'>,
  input: { address: Address; fromBlock: bigint; toBlock: bigint },
): Promise<Log[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.getLogs(input);
    } catch (error) {
      // Range-cap errors are deterministic — the caller shrinks and retries;
      // burning backoff retries on them only delays the recovery.
      if (parseGetLogsRangeLimit(error) !== null) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= RATE_LIMIT_RETRIES || !RATE_LIMIT_PATTERN.test(message)) throw error;
      // Rate-limit windows are per-second on public nodes: a fixed doubling
      // re-enters the same window (and the 429s compound across concurrent
      // workers). Exponential base-2s + per-attempt jitter spreads retries
      // out of the throttle window; Retry-After wins when the provider sends
      // one (seconds → ms).
      const retryAfterMs = parseRetryAfterMs(error);
      const backoffMs = retryAfterMs ?? 2000 * 2 ** attempt + Math.floor(Math.random() * 1000);
      await sleep(backoffMs);
    }
  }
}

/** Retry-After header value (seconds) surfaced by viem as `status`, `headers`, or message text. */
export function parseRetryAfterMs(error: unknown): number | null {
  if (error && typeof error === "object") {
    const e = error as { headers?: Record<string, unknown>; message?: string };
    const header = e.headers?.["retry-after"] ?? e.headers?.["Retry-After"];
    if (typeof header === "string" && /^\d+$/.test(header)) return Number(header) * 1000;
    const match = /retry-after[:\s]+(\d+)/i.exec(e.message ?? "");
    if (match) return Number(match[1]) * 1000;
  }
  return null;
}

function containsAddress(value: unknown, wallet: Address): boolean {
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return isAddressEqual(value as Address, wallet);
  if (Array.isArray(value)) return value.some((v) => containsAddress(v, wallet));
  if (value && typeof value === "object") return Object.values(value).some((v) => containsAddress(v, wallet));
  return false;
}

export async function loadSoulVaultActivity(wallet: Address, config: SoulVaultClientConfig): Promise<SoulVaultActivity[]> {
  const client = createSoulVaultPublicClient(config);
  const deployments: SoulVaultDeployment[] = config.deployments;
  const decoded = (await Promise.all(deployments.map(async (deployment) => {
    const logs = await getLogsChunked(client, { address: deployment.address, fromBlock: deployment.fromBlock, toBlock: "latest" });
    return logs.flatMap((log) => decodeKnownLog(log, deployment));
  }))).flat();
  const senders = new Map<Hex, Address>();
  await Promise.all([...new Set(decoded.map(({ log }) => log.transactionHash).filter(Boolean))].map(async (hash) => {
    const tx = await client.getTransaction({ hash: hash as Hex });
    senders.set(hash as Hex, tx.from);
  }));
  return decoded.flatMap(({ log, deployment, eventName, args }) => {
    if (!log.transactionHash || log.blockNumber == null) return [];
    const sender = senders.get(log.transactionHash);
    const initiated = !!sender && isAddressEqual(sender, wallet);
    const referenced = containsAddress(args, wallet);
    if (!initiated && !referenced) return [];
    return [{ contract: deployment.address, contractKind: deployment.kind, contractLabel: deployment.label, eventName, args, blockNumber: log.blockNumber, logIndex: log.logIndex ?? 0, transactionHash: log.transactionHash, relationship: initiated && referenced ? "initiated-and-referenced" as const : initiated ? "initiated" as const : "referenced" as const }];
  }).sort((a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex);
}

function decodeKnownLog(log: Log, deployment: SoulVaultDeployment) {
  try {
    const decoded = decodeEventLog({ abi: SOULVAULT_EVENT_ABIS[deployment.kind], data: log.data, topics: log.topics });
    if (decoded.eventName == null) return [];
    return [{ log, deployment, eventName: decoded.eventName, args: (decoded.args ?? {}) as Record<string, unknown> }];
  } catch { return []; }
}
