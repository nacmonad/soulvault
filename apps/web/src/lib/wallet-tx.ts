import type { Address, Hex } from "viem";

import {
  chainById,
  publicClientForChainId,
  type SoulVaultChain,
} from "@/lib/chains";
import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
} from "@/lib/onchain/client";

type Injected = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

function injected(): Injected | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { ethereum?: Injected }).ethereum;
}

/**
 * A transport for signing + broadcasting transactions and waiting for
 * receipts. The default channel talks to the injected browser wallet; the
 * Ledger channel (ledger-tx.ts) signs on the DMK device session and broadcasts
 * raw txs straight to the configured RPC. The dashboard wallet provider swaps
 * the active channel on connect/disconnect, so every write path (wizards, ENS
 * writes, treasury + document flows) works under either connector unchanged.
 */
export type WalletReceipt = {
  status: "success" | "reverted";
  contractAddress?: Address;
  blockNumber: bigint;
};

export type TxSubmitInput = {
  from: Address;
  /** `null` = contract creation (eth_sendTransaction with no `to`). */
  to: Address | null;
  data: Hex;
  value?: bigint;
  /**
   * Target chain for this tx. The browser channel switches the injected
   * wallet to it when needed (prompting to add the chain if unknown); the
   * Ledger channel estimates/broadcasts on that chain's RPC. `undefined`
   * leaves the wallet on whatever network it is currently on.
   */
  chainId?: number;
};

export type TxChannel = {
  submit(input: TxSubmitInput): Promise<Hex>;
  waitForReceipt(hash: Hex): Promise<WalletReceipt>;
  signTypedData?(input: { address: Address; payload: string }): Promise<string>;
};

/**
 * Pre-estimate gas with the app's own public client before handing the tx to
 * the injected wallet. MetaMask runs its internal estimator against whatever
 * network RPC it has configured, which can fail (revert-timeout on large
 * contract-creation payloads) even when the tx is perfectly valid; when `gas`
 * is present in eth_sendTransaction params the wallet uses it and skips its
 * own estimation. Returns `undefined` on any failure so the request falls
 * back to wallet-side estimation.
 */
async function estimateGasUpfront(input: TxSubmitInput): Promise<bigint | undefined> {
  try {
    const config = getBrowserSoulVaultClientConfig();
    if (!config) return undefined;
    const client =
      input.chainId !== undefined && input.chainId !== config.chainId
        ? publicClientForChainId(input.chainId)
        : createSoulVaultPublicClient(config);
    if (!client) return undefined;
    return await client.estimateGas({
      account: input.from,
      ...(input.to !== null ? { to: input.to } : {}),
      data: input.data,
      ...(input.value !== undefined ? { value: input.value } : {}),
    });
  } catch (error) {
    console.warn(
      `[wallet-tx] App-side gas estimate failed for ${
        input.to === null ? "contract creation" : `call to ${input.to}`
      }; falling back to wallet-side estimation.`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

/** Map raw wallet RPC rejections (EIP-1193 provider errors) to actionable copy. */
function walletRequestError(cause: unknown): Error {
  const e = cause as { code?: number; message?: string };
  if (e?.code === 4100) {
    return new Error(
      "This site is not authorized in your wallet. Approve the connection prompt (or reconnect from the wallet extension), then try again.",
    );
  }
  if (e?.code === -32002) {
    return new Error("A wallet request is already pending — open your wallet extension to continue.");
  }
  if (e?.code === 4001) {
    return new Error("Request rejected in the wallet.");
  }
  return cause instanceof Error ? cause : new Error(e?.message ?? "Wallet request failed.");
}

/**
 * Idempotently ensure the site holds account permission (eth_requestAccounts is
 * a no-op prompt when already authorized) and that the target account is
 * actually available in the injected wallet — eth_sendTransaction from an
 * unauthorized site fails with 4100 otherwise.
 */
async function ensureWalletAuthorized(from?: Address): Promise<Injected> {
  const provider = injected();
  if (!provider) throw new Error("No injected browser wallet. Connect one to sign.");
  let accounts: Address[];
  try {
    accounts = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  } catch (cause) {
    throw walletRequestError(cause);
  }
  if (from && accounts.length > 0 && !accounts.some((a) => a.toLowerCase() === from.toLowerCase())) {
    throw new Error(
      `${from} is not available in the injected wallet. Switch to a browser-wallet connection for that address.`,
    );
  }
  return provider;
}

/**
 * Make sure the injected wallet's active network matches `chainId`, switching
 * (and adding the chain) if needed. No-op when the wallet is already there.
 */
async function ensureWalletOnChain(provider: Injected, chainId: number): Promise<void> {
  const current = (await provider.request({ method: "eth_chainId" })) as Hex;
  if (Number(BigInt(current)) === chainId) return;
  const chain = chainById(chainId);
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (cause) {
    // 4902 = chain not added to the wallet yet.
    if ((cause as { code?: number })?.code !== 4902 || !chain) {
      throw walletRequestError(cause);
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [addChainParams(chain)],
    });
  }
}

function addChainParams(chain: SoulVaultChain) {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.currency,
    rpcUrls: [chain.rpcUrl],
    blockExplorerUrls: [chain.explorer],
  };
}

// ---------------------------------------------------------------------------
// Browser (injected wallet) channel
// ---------------------------------------------------------------------------

/**
 * MetaMask's internal estimator can fail (revert/timeout on large creation
 * payloads) even when the app pre-estimated the exact same tx successfully —
 * when the app-side `gas` is present, a wallet estimation error is not a real
 * revert, so rethrow with context instead of the cryptic viem payload.
 */
function walletSendError(cause: unknown, gas: bigint | undefined): Error {
  const base = walletRequestError(cause);
  const message = (cause as { message?: string } | null)?.message ?? "";
  const looksLikeEstimateFailure =
    /estimate gas/i.test(message) || /execution reverted/i.test(message);
  if (!looksLikeEstimateFailure) return base;
  if (gas !== undefined) {
    return new Error(
      `Your wallet failed its own gas estimation for this transaction, even though the app ` +
        `pre-estimated ${gas} gas successfully against the configured RPC. This is usually a ` +
        `wallet-side estimation issue, not a contract revert. Retry the step; if it keeps ` +
        `failing, switch the wallet's active network to one with a working RPC, or connect a ` +
        `Ledger device session (the device channel estimates via the app RPC directly). ` +
        `Wallet said: ${base.message}`,
    );
  }
  return new Error(
    `The wallet failed to estimate this transaction, and the app could not pre-estimate it ` +
      `either (look for a "[wallet-tx] App-side gas estimate failed" warning in the browser ` +
      `console). Either the tx would genuinely revert, or the RPC used for estimation is ` +
      `failing — public Sepolia endpoints are known to choke on large contract-creation ` +
      `payloads. Check the RPC in /dashboard/settings and retry. ` +
      `Wallet said: ${base.message}`,
  );
}

const browserChannel: TxChannel = {
  async submit(input) {
    const provider = await ensureWalletAuthorized(input.from);
    if (input.chainId !== undefined) {
      await ensureWalletOnChain(provider, input.chainId);
    }
    const gas = await estimateGasUpfront(input);
    let hash: unknown;
    try {
      hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: input.from,
            ...(input.to !== null ? { to: input.to } : {}),
            data: input.data,
            ...(input.value !== undefined ? { value: `0x${input.value.toString(16)}` } : {}),
            ...(gas !== undefined ? { gas: `0x${gas.toString(16)}` } : {}),
          },
        ],
      });
    } catch (cause) {
      throw walletSendError(cause, gas);
    }
    return hash as Hex;
  },

  async waitForReceipt(hash) {
    const provider = injected();
    if (!provider) throw new Error("No injected browser wallet.");
    // Poll eth_getTransactionReceipt — static export has no viem public client wired
    // into this module, and every browser wallet exposes the standard JSON-RPC methods.
    for (let attempt = 0; attempt < 120; attempt++) {
      const receipt = (await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      })) as {
        status?: Hex;
        contractAddress?: Address;
        blockNumber?: Hex;
      } | null;
      if (receipt) {
        return {
          status: receipt.status === "0x1" ? "success" : "reverted",
          contractAddress: receipt.contractAddress,
          blockNumber: BigInt(receipt.blockNumber ?? "0x0"),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`Timed out waiting for transaction receipt (tx ${hash}).`);
  },

  async signTypedData(input) {
    const provider = await ensureWalletAuthorized(input.address);
    try {
      return (await provider.request({
        method: "eth_signTypedData_v4",
        params: [input.address, input.payload],
      })) as string;
    } catch (cause) {
      throw walletRequestError(cause);
    }
  },
};

// ---------------------------------------------------------------------------
// Active channel — defaults to the browser wallet; the wallet provider swaps
// in the Ledger channel on connect (setTxChannel) and restores this default
// on disconnect.
// ---------------------------------------------------------------------------

let activeChannel: TxChannel = browserChannel;

/** Swap the active transaction channel. `undefined` restores the browser wallet. */
export function setTxChannel(channel: TxChannel | undefined): void {
  activeChannel = channel ?? browserChannel;
}

export async function sendWalletTransaction(input: TxSubmitInput): Promise<Hex> {
  return activeChannel.submit(input);
}

export async function waitForWalletReceipt(hash: Hex): Promise<WalletReceipt> {
  return activeChannel.waitForReceipt(hash);
}

export async function signTypedData(input: { address: Address; payload: string }): Promise<string> {
  if (!activeChannel.signTypedData) {
    throw new Error("Typed-data signing is not available on the active wallet channel.");
  }
  return activeChannel.signTypedData(input);
}

/**
 * Send a contract-creation transaction and wait for the receipt.
 * Returns the deployed address from the receipt's `contractAddress` field and
 * the deploy block from the same receipt (never re-read cross-chain later).
 */
export async function deployWalletContract(input: {
  from: Address;
  bytecode: Hex;
  chainId?: number;
}): Promise<{ txHash: Hex; contractAddress: Address; blockNumber: bigint }> {
  const hash = await sendWalletTransaction({
    from: input.from,
    to: null,
    data: input.bytecode,
    ...(input.chainId !== undefined ? { chainId: input.chainId } : {}),
  });
  const receipt = await waitForWalletReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error(`Deploy transaction reverted (tx ${hash}).`);
  }
  if (!receipt.contractAddress || receipt.contractAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error(`Deploy receipt has no contractAddress (tx ${hash}).`);
  }
  return { txHash: hash, contractAddress: receipt.contractAddress, blockNumber: receipt.blockNumber };
}
