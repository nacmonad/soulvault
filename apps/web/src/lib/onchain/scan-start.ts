/**
 * Scan-start block resolution for runtime-discovered contracts.
 *
 * ENS announces which contracts exist, but org records do not carry deploy
 * blocks, so the events layer needs a starting block for historical scans:
 * an explicit hint (when a record carries one) → binary search over
 * eth_getCode → a conservative recent window. Cached per contract so the
 * (potentially ~24-call) search runs once per browser.
 */
import type { Address, PublicClient } from "viem";

import { publicClientForChainId } from "@/lib/chains";
import { createSoulVaultPublicClient, getBrowserSoulVaultClientConfig } from "./client";

const FROM_BLOCK_CACHE_PREFIX = "soulvault.fromBlock.v2.";
/** When neither a hint nor a code search yields a deploy block, scan a recent window. */
const FALLBACK_SCAN_WINDOW = 1_000_000n;

function clientForChain(chainId: number): PublicClient {
  const config = getBrowserSoulVaultClientConfig();
  if (config && config.chainId === chainId) return createSoulVaultPublicClient(config);
  return publicClientForChainId(chainId) as PublicClient;
}

/**
 * Find the first block where `address` has code via binary search over
 * eth_getCode (~log2(latest) calls). Returns null when the address has no code
 * at latest or the RPC refuses historical reads.
 */
export async function findContractDeployBlock(
  client: PublicClient,
  address: Address,
): Promise<bigint | null> {
  let latest: bigint;
  try {
    latest = await client.getBlockNumber();
    const code = await client.getBytecode({ address });
    if (!code || code === "0x") return null;
  } catch {
    return null;
  }
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    try {
      const code = await client.getBytecode({ address, blockNumber: mid });
      if (code && code !== "0x") {
        hi = mid;
      } else {
        lo = mid + 1n;
      }
    } catch {
      // Historical getCode unavailable (non-archive RPC) — don't guess.
      return null;
    }
  }
  return lo;
}

/**
 * Scan-start block for a contract's event log: an explicit deploy-block hint
 * when the caller has one (e.g. an ENS record), else a binary search over
 * eth_getCode, else a conservative recent window. Cached per address.
 */
export async function contractScanStartBlock(input: {
  address: Address;
  chainId: number;
  /** Deploy block from an authoritative record (ENS), when known. */
  deployedAtBlock?: number | bigint | null;
}): Promise<bigint> {
  const cacheKey = `${FROM_BLOCK_CACHE_PREFIX}${input.chainId}:${input.address.toLowerCase()}`;
  try {
    const cached = window.localStorage.getItem(cacheKey);
    if (cached && /^\d+$/.test(cached)) return BigInt(cached);
  } catch {
    // localStorage unavailable (SSR/private mode) — compute each session.
  }

  const client = clientForChain(input.chainId);
  let fromBlock: bigint | null = null;
  if (input.deployedAtBlock != null) {
    fromBlock = BigInt(input.deployedAtBlock);
  }
  if (fromBlock === null) {
    fromBlock = await findContractDeployBlock(client, input.address);
  }
  if (fromBlock === null) {
    // Fallback estimates are NOT cached (under the deploy-block key): on
    // non-archive RPCs this would pin every future scan to a ~1M-block window
    // even after switching to an archive provider. Recomputing costs one
    // getBlockNumber call.
    const latest = await client.getBlockNumber().catch(() => null);
    fromBlock = latest === null ? 0n : latest > FALLBACK_SCAN_WINDOW ? latest - FALLBACK_SCAN_WINDOW : 0n;
    return fromBlock;
  }
  try {
    window.localStorage.setItem(cacheKey, fromBlock.toString());
  } catch {
    // non-fatal
  }
  return fromBlock;
}
