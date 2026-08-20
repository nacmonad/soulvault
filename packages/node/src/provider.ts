import { JsonRpcProvider } from 'ethers';

/**
 * Chain ids that are local dev nodes: 1337 is the ens-app-v3 stack, 31337 a bare anvil.
 */
const DEV_CHAIN_IDS = new Set<number>([1337, 31337]);

/**
 * ethers polls for transaction receipts every `pollingInterval` ms, default 4000.
 *
 * That default is right for a public network — blocks are seconds apart and polling
 * harder just burns rate limit. On a local chain that mines the instant a transaction
 * arrives it is pure latency: the receipt exists immediately and we sit for up to four
 * seconds before looking. Across an integration run of a few hundred transactions that
 * is minutes of nothing.
 */
const DEV_POLLING_INTERVAL_MS = 100;

/**
 * Build a JsonRpcProvider, tuned for a local dev chain when we are talking to one.
 *
 * Behaviour against real networks is unchanged — the faster polling is gated on the
 * chain id being a known dev node, so Sepolia and 0G keep ethers' 4s default and we
 * never hammer a public RPC.
 */
export function createJsonRpcProvider(url: string, chainId?: number): JsonRpcProvider {
  const isDevChain = chainId !== undefined && DEV_CHAIN_IDS.has(chainId);

  // Disable the request cache on dev chains, together with the faster polling below.
  //
  // ethers shares identical requests for `cacheTimeout` ms (default 250), and
  // getTransactionCount goes through it. On a local chain consecutive transactions land
  // well inside 250ms, so the second one reads the first one's nonce and the node
  // rejects it with "nonce too low". The 4s polling default used to space transactions
  // out far enough to hide this; dropping to 100ms exposed it immediately.
  //
  // Left at the default for real networks: there the spacing is naturally larger, and
  // sharing repeat reads inside a quarter second is worth having against a public RPC.
  const provider = new JsonRpcProvider(
    url,
    chainId,
    isDevChain ? { cacheTimeout: -1 } : undefined,
  );

  if (isDevChain) {
    provider.pollingInterval = DEV_POLLING_INTERVAL_MS;
  }
  return provider;
}
