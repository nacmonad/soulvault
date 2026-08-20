import { JsonRpcProvider } from 'ethers';

/**
 * Provider for integration tests, with request caching disabled.
 *
 * ethers shares identical in-flight requests for `cacheTimeout` ms (default 250,
 * see AbstractProvider). That is fine for reads, but `getTransactionCount` routes
 * through the same cache, so two nonce reads less than 250ms apart return the same
 * value — and on a local chain back-to-back transactions land well inside that
 * window. The second one is then signed with a nonce the first already used and the
 * node rejects it with "nonce too low".
 *
 * Measured on a local anvil, 50 sequential transactions from one wallet:
 *   default cache    -> 14 NONCE_EXPIRED failures
 *   cacheTimeout: -1 -> 0
 *
 * A negative timeout bypasses the cache entirely.
 */
export function makeTestProvider(rpcUrl: string): JsonRpcProvider {
  return new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
}
