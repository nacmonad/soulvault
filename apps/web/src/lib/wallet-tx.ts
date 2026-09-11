import { serializeSignature, type Address, type Hex } from "viem";

export type ChainSender = (input: { from: Address; to: Address; data: Hex }) => Promise<Hex>;

import {
  chainById,
  publicClientForChainId,
  type SoulVaultChain,
} from "@/lib/chains";
import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
} from "@/lib/onchain/client";
import { parseRpcUrlList } from "@/lib/rpc-settings";

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

type AppRpcClient = {
  estimateGas: (args: {
    account: Address;
    to?: Address;
    data: Hex;
    value?: bigint;
  }) => Promise<bigint>;
  getGasPrice: () => Promise<bigint>;
  getTransactionCount: (args: { address: Address }) => Promise<number>;
  sendRawTransaction: (args: { serializedTransaction: Hex }) => Promise<Hex>;
  waitForTransactionReceipt?: (args: {
    hash: Hex;
    pollingInterval?: number;
    timeout?: number;
  }) => Promise<{
    status: "success" | "reverted";
    contractAddress?: Address;
    blockNumber: bigint;
  }>;
};

function appRpcClient(input: { chainId?: number }): AppRpcClient | null {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  if (input.chainId !== undefined && input.chainId !== config.chainId) {
    return (publicClientForChainId(input.chainId) as AppRpcClient | null) ?? null;
  }
  return createSoulVaultPublicClient(config) as AppRpcClient;
}

function toQuantity(value: bigint | number): Hex {
  return `0x${value.toString(16)}` as Hex;
}

type PreparedTx = {
  from: Address;
  to?: Address;
  data: Hex;
  value: Hex;
  nonce: Hex;
  gas: Hex;
  gasPrice: Hex;
  chainId?: Hex;
};

/**
 * Build a fully specified legacy tx against the dashboard RPC. Rabby still
 * calls eth_gasPrice on WalletConnect (free plan has no Sepolia) when any of
 * nonce/gas/gasPrice is missing, even if the dapp passed a partial tx.
 */
async function prepareAppTx(input: TxSubmitInput): Promise<{ client: AppRpcClient; tx: PreparedTx; gas: bigint }> {
  const client = appRpcClient(input);
  if (!client) {
    throw new Error("SoulVault dashboard config missing — set NEXT_PUBLIC_SOULVAULT_* env vars.");
  }
  const estimateArgs = {
    account: input.from,
    ...(input.to !== null ? { to: input.to } : {}),
    data: input.data,
    ...(input.value !== undefined ? { value: input.value } : {}),
  };
  let nonce: number;
  let gas: bigint;
  let gasPrice: bigint;
  try {
    [nonce, gas, gasPrice] = await Promise.all([
      client.getTransactionCount({ address: input.from }),
      client.estimateGas(estimateArgs),
      client.getGasPrice(),
    ]);
  } catch (error) {
    throw new Error(
      `Could not prepare the transaction against the dashboard RPC (${error instanceof Error ? error.message : String(error)}). Check the RPC in /dashboard/settings.`,
    );
  }
  const tx: PreparedTx = {
    from: input.from,
    ...(input.to !== null ? { to: input.to } : {}),
    data: input.data,
    value: toQuantity(input.value ?? 0n),
    nonce: toQuantity(nonce),
    gas: toQuantity(gas),
    gasPrice: toQuantity(gasPrice),
    ...(input.chainId !== undefined ? { chainId: toQuantity(input.chainId) } : {}),
  };
  return { client, tx, gas };
}

function walletErrorText(cause: unknown): string {
  if (cause == null || typeof cause !== "object") return typeof cause === "string" ? cause : "";
  const e = cause as Record<string, unknown>;
  const nested = [e.data, e.error, e.cause]
    .filter((value) => value && typeof value === "object")
    .map((value) => walletErrorText(value))
    .join(" ");
  return [e.message, e.details, e.shortMessage, nested].filter(Boolean).join(" ");
}

function isUserRejected(cause: unknown): boolean {
  return (cause as { code?: number } | null)?.code === 4001;
}

function isMissingMethod(cause: unknown): boolean {
  const e = cause as { code?: number; message?: string } | null;
  if (e?.code === -32601) return true;
  return /method .*not (found|supported|available)|does not exist|eth_signTransaction/i.test(
    e?.message ?? "",
  );
}

function isWalletConnectRpcFailure(cause: unknown): boolean {
  return /not available on free plan|rpc\.walletconnect\.org/i.test(walletErrorText(cause));
}

/** Map raw wallet RPC rejections (EIP-1193 provider errors) to actionable copy. */
function walletRequestError(cause: unknown): Error {
  const text = walletErrorText(cause);
  if (/not available on free plan|rpc\.walletconnect\.org/i.test(text)) {
    return new Error(
      "The wallet's Sepolia RPC is WalletConnect (free plan does not include this chain). Retry the step — gas and gasPrice are filled from the dashboard RPC. If it persists, set Rabby's Sepolia RPC to the URL in Settings.",
    );
  }
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

function addChainParams(chain: SoulVaultChain, rpcUrl: string) {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.currency,
    rpcUrls: [rpcUrl],
    blockExplorerUrls: [chain.explorer],
  };
}

function rpcUrlForChain(chainId: number): string | undefined {
  const config = getBrowserSoulVaultClientConfig();
  if (config && chainId === config.chainId) {
    return parseRpcUrlList(config.rpcUrl)[0] ?? config.rpcUrl;
  }
  return chainById(chainId)?.rpcUrl;
}

/**
 * Point the wallet at the dashboard RPC for this chain. Rabby defaults Sepolia
 * to WalletConnect's free endpoint, which rejects eth_gasPrice. add+switch is
 * best-effort: a rejected prompt must not block eth_signTransaction + raw send.
 */
async function pinChainRpc(provider: Injected, chainId: number): Promise<void> {
  const chain = chainById(chainId);
  const rpcUrl = rpcUrlForChain(chainId);
  if (!chain || !rpcUrl) return;
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [addChainParams(chain, rpcUrl)],
    });
  } catch (cause) {
    if (!isUserRejected(cause)) throw walletRequestError(cause);
  }
  const current = (await provider.request({ method: "eth_chainId" })) as Hex;
  if (Number(BigInt(current)) === chainId) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${chainId.toString(16)}` }],
    });
  } catch (cause) {
    if ((cause as { code?: number })?.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [addChainParams(chain, rpcUrl)],
      });
      return;
    }
    if (!isUserRejected(cause)) throw walletRequestError(cause);
  }
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

const RECEIPT_TIMEOUT_MS = 240_000;
const receiptChainByHash = new Map<Hex, number | undefined>();

function looksLikeTxHash(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

async function signAndBroadcast(
  provider: Injected,
  client: AppRpcClient,
  tx: PreparedTx,
  gas: bigint,
): Promise<Hex> {
  try {
    const signed = (await provider.request({
      method: "eth_signTransaction",
      params: [tx],
    })) as string;
    if (looksLikeTxHash(signed)) return signed;
    return await client.sendRawTransaction({ serializedTransaction: signed as Hex });
  } catch (cause) {
    if (isUserRejected(cause)) throw walletRequestError(cause);
    if (!isMissingMethod(cause) && !isWalletConnectRpcFailure(cause)) {
      throw walletSendError(cause, gas);
    }
  }
  try {
    return (await provider.request({
      method: "eth_sendTransaction",
      params: [tx],
    })) as Hex;
  } catch (cause) {
    throw walletSendError(cause, gas);
  }
}

const browserChannel: TxChannel = {
  async submit(input) {
    const provider = await ensureWalletAuthorized(input.from);
    if (input.chainId !== undefined) {
      await pinChainRpc(provider, input.chainId);
    }
    const { client, tx, gas } = await prepareAppTx(input);
    const txHash = await signAndBroadcast(provider, client, tx, gas);
    receiptChainByHash.set(txHash, input.chainId);
    return txHash;
  },

  async waitForReceipt(hash) {
    const client = appRpcClient({ chainId: receiptChainByHash.get(hash) });
    if (client?.waitForTransactionReceipt) {
      const receipt = await client.waitForTransactionReceipt({
        hash,
        pollingInterval: 2_000,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      return {
        status: receipt.status === "success" ? "success" : "reverted",
        contractAddress: receipt.contractAddress,
        blockNumber: receipt.blockNumber,
      };
    }
    const provider = injected();
    if (!provider) throw new Error("No injected browser wallet.");
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

/** Ledger Ethereum app returns v as 0/1, 27/28, or EIP-155. */
export function yParityFromV(v: number): 0 | 1 {
  if (v === 0 || v === 27) return 0;
  if (v === 1 || v === 28) return 1;
  return (v % 2 === 0 ? 1 : 0) as 0 | 1;
}

export function asHex(value: string): Hex {
  return (value.startsWith("0x") ? value : `0x${value}`) as Hex;
}

export function ledgerSignature(sig: { r: string; s: string; v: number }): {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
} {
  return { r: asHex(sig.r), s: asHex(sig.s), yParity: yParityFromV(sig.v) };
}

export function serializedLedgerSignature(sig: { r: string; s: string; v: number }): Hex {
  return serializeSignature(ledgerSignature(sig));
}
