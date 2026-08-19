import { JsonRpcProvider } from 'ethers';

/**
 * Poll a JSON-RPC endpoint for readiness by calling `eth_chainId`.
 * Returns the resolved chainId on success. Throws with a clear, actionable
 * message if the endpoint is unreachable or returns a mismatched chainId.
 */
export async function probeChain(opts: {
  rpcUrl: string;
  expectedChainId?: number;
  label: string;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<number> {
  const deadline = Date.now() + (opts.timeoutMs ?? 5_000);
  const interval = opts.intervalMs ?? 100;
  const provider = new JsonRpcProvider(opts.rpcUrl);

  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const network = await provider.getNetwork();
      const chainId = Number(network.chainId);
      if (opts.expectedChainId !== undefined && chainId !== opts.expectedChainId) {
        throw new Error(
          `${opts.label} at ${opts.rpcUrl} reported chainId ${chainId}, expected ${opts.expectedChainId}. ` +
            `Update .env.test or restart the local node with the correct chain id.`,
        );
      }
      return chainId;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `${opts.label} at ${opts.rpcUrl} is not reachable after ${opts.timeoutMs ?? 5_000}ms.\n` +
      `Start it before running integration tests. Last error: ${detail}`,
  );
}
