/**
 * Ledger transaction channel: signs each transaction on the DMK device session
 * and broadcasts the raw signed tx straight to the configured RPC — no injected
 * wallet involvement, so the dashboard can create treasuries/swarms with only a
 * Ledger connected.
 *
 * Mirrors the CLI's LedgerEthersSigner path (packages/node/src/signer.ts):
 * - ALWAYS legacy type-0 with a single gasPrice — the CLI rebuilds EIP-1559
 *   payloads as legacy before the device prompt (the Ledger Ethereum app
 *   frequently answers 6a80 "Invalid data" on typed payloads, and typed-tx
 *   signature reconstruction produced invalid-signature rejections on every
 *   production RPC). The browser channel keeps its own 1559 pricing; only the
 *   device lane is legacy,
 * - the device's signature `v` byte read as a parity bit and the full EIP-155
 *   `v` reconstructed (the device returns one byte; Sepolia's v ≈ 22.3M cannot
 *   fit, and 27/28 vs 0/1 conventions differ between app versions).
 */
import { createPublicClient, http, keccak256, serializeTransaction, type Address, type Hex, type PublicClient } from "viem";

import { chainById, publicClientForChainId } from "@/lib/chains";
import { createSoulVaultPublicClient, type SoulVaultClientConfig } from "@/lib/onchain/client";
import type { TxChannel, TxSubmitInput } from "@/lib/wallet-tx";

export type DeviceTransactionSignature = { r: Hex; s: Hex; v: number };

/** Minimal viem public-client surface used by the Ledger channel. */
type LedgerRpcClient = {
  getTransactionCount(args: { address: Address; blockTag?: "pending" }): Promise<number>;
  getGasPrice(): Promise<bigint>;
  estimateGas(args: { account: Address; to?: Address; data: Hex; value?: bigint }): Promise<bigint>;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  waitForTransactionReceipt(args: {
    hash: Hex;
    retryCount?: number;
    retryDelay?: number;
    pollingInterval?: number;
    timeout?: number;
  }): Promise<{
    status: string;
    blockNumber: bigint;
    contractAddress?: Address | null;
  }>;
};

/**
 * Known-good public fallback RPCs, tried only when the configured RPC fails
 * pre-flight (nonce / gas price / gas estimate). Public Sepolia endpoints are
 * known to choke on large contract-creation payloads, so a single bad estimate
 * must not sink a deploy the device is about to sign.
 */
const FALLBACK_RPC_URLS: Record<number, string[]> = {
  11155111: ["https://1rpc.io/sepolia", "https://sepolia.gateway.tenderly.co"],
};

/**
 * Confirmation wait ceiling for the Ledger channel. viem's own default is
 * 120s, which reports a false failure for any tx that mines late (congested
 * public mempools, legacy-priced txs); the tx is already broadcast and cannot
 * be recalled, so we out-wait it. 15 minutes covers slow public testnets;
 * 0G Galileo receipt lag is a known case too.
 */
export const RECEIPT_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Wrap a receipt-wait failure. The critical distinction: "reverted" (the tx
 * executed and failed — re-running must be a deliberate choice) vs "never saw
 * a receipt" (the tx is still broadcast and may land at any moment — keep the
 * etherscan tab open before re-running).
 */
export function receiptWaitError(hash: Hex, chainId: number | undefined, cause: unknown): Error {
  const timedOut = cause instanceof Error && /timed out while waiting for transaction/i.test(cause.message);
  const explorer =
    chainId === 11155111
      ? ` https://sepolia.etherscan.io/tx/${hash}`
      : chainId === 16602
        ? ` (check the tx on your 0G explorer of choice)`
        : "";
  if (timedOut) {
    return new Error(
      `No confirmation within ${Math.round(RECEIPT_TIMEOUT_MS / 60000)} minutes, but the tx is ` +
        `signed and broadcast — it may still land:${explorer} tx ${hash}. ` +
        `Before re-running this step, check the tx status above: if it confirmed, the step ` +
        `is already done; if it is still pending, wait rather than double-send. ` +
        `If it did not land, a bumped gas price on retry usually fixes it. ` +
        `Original error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return cause instanceof Error ? cause : new Error(String(cause));
}

export function createLedgerTxChannel(input: {
  signTransaction(unsignedSerialized: Hex): Promise<DeviceTransactionSignature>;
  /** DMK typed-data signing (EIP-712) — device path, same session. */
  signTypedData(payload: string): Promise<string>;
  config: SoulVaultClientConfig;
  /**
   * Fired right before the device prompt with the keccak hash of the unsigned
   * tx — the exact bytes the device will display when it blind-signs (e.g.
   * contract deploys, which CAL cannot decode). UIs surface it for comparison.
   */
  onSigningPrompt?(unsignedHash: Hex): void;
  /** Test seam — defaults to a viem public client over the configured RPC. */
  client?: PublicClient;
  /** Test seam — extra pre-flight candidates beyond the configured RPC. */
  fallbacks?: Array<{ label: string; client: PublicClient | LedgerRpcClient }>;
}): TxChannel {
  const client = (input.client ?? createSoulVaultPublicClient(input.config)) as LedgerRpcClient;
  const chainId = input.config.chainId;

  /**
   * Which chain each broadcast tx actually went to, so receipts are polled on
   * the same chain. `TxChannel.waitForReceipt(hash)` carries no chainId, and a
   * multi-chain deploy polled on the wrong RPC hangs forever (e.g. a 0G
   * Galileo deploy receipt requested from the configured Sepolia endpoint).
   */
  const receiptChainByHash = new Map<Hex, number>();

  /**
   * Resolve the per-chain client + its RPC label together, so error copy never
   * claims a tx was sent "to" a URL it wasn't. Unknown chainIds fall back to
   * the configured client with its configured label.
   */
  function primaryForChain(txChainId: number | undefined): { client: LedgerRpcClient; label: string } {
    if (txChainId === undefined || txChainId === chainId) {
      return { client, label: input.config.rpcUrl };
    }
    const perChain = publicClientForChainId(txChainId);
    if (!perChain) {
      return { client, label: input.config.rpcUrl };
    }
    const label = chainById(txChainId)?.rpcUrl ?? `chain ${txChainId} public RPC`;
    return { client: perChain as LedgerRpcClient, label };
  }

  function clientForUrl(url: string, chainIdForUrl: number): LedgerRpcClient {
    return createPublicClient({
      chain: {
        id: chainIdForUrl,
        name: `SoulVault fallback chain ${chainIdForUrl}`,
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [url] } },
      },
      transport: http(url),
    }) as unknown as LedgerRpcClient;
  }

  type Candidate = { label: string; client: LedgerRpcClient };

  /** Target-chain RPC first, then known-good public fallbacks for the chain. */
  function candidatesFor(signedChainId: number, primary: Candidate): Candidate[] {
    const candidates: Candidate[] = [primary];
    if (input.fallbacks) {
      for (const { label, client: fallbackClient } of input.fallbacks) {
        candidates.push({ label, client: fallbackClient as LedgerRpcClient });
      }
    } else {
      for (const url of FALLBACK_RPC_URLS[signedChainId] ?? []) {
        candidates.push({ label: url, client: clientForUrl(url, signedChainId) });
      }
    }
    return candidates;
  }

  type Preflight = { candidate: Candidate; nonce: number; gasPrice: bigint; gas: bigint };

  /**
   * Pre-flight (nonce + gas price + gas estimate) against the first RPC that
   * answers. The Ledger channel has no wallet-side estimator to fall back on,
   * so a flaky public endpoint here would otherwise hard-fail a deploy the
   * device is already primed to sign. Pricing is always legacy gasPrice — the
   * device lane never uses typed-tx fees (CLI parity).
   */
  async function preflight(tx: TxSubmitInput, candidates: Candidate[]): Promise<Preflight> {
    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        const [nonce, gasPrice, gas] = await Promise.all([
          candidate.client.getTransactionCount({ address: tx.from, blockTag: "pending" }),
          candidate.client.getGasPrice(),
          candidate.client.estimateGas({
            account: tx.from,
            ...(tx.to !== null ? { to: tx.to } : {}),
            data: tx.data,
            ...(tx.value !== undefined ? { value: tx.value } : {}),
          }),
        ]);
        return { candidate, nonce, gasPrice, gas };
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        failures.push(`${candidate.label}: ${message.replace(/\s+/g, " ").slice(0, 240)}`);
      }
    }
    throw new Error(
      `Could not pre-flight this transaction (nonce / gas price / gas estimate) against any RPC. ` +
        `Configured RPC: ${input.config.rpcUrl}. Attempts: ${failures.join(" | ")} ` +
        `If that URL is not the endpoint you expect, check the dashboard settings override ` +
        `(localStorage key "soulvault.rpcUrlOverride") and restart the dev server so ` +
        `NEXT_PUBLIC_SOULVAULT_* env changes take effect. Public Sepolia RPCs are also known to ` +
        `choke on large contract-creation payloads — retry, or point the dashboard at a working RPC.`,
    );
  }

  /** Broadcast the signed raw tx, rotating to other RPCs if the first refuses. Re-sending the same raw tx is idempotent (same hash). */
  async function broadcast(signed: Hex, preferred: Preflight, candidates: Candidate[]): Promise<Hex> {
    const ordered = [preferred.candidate, ...candidates.filter((c) => c !== preferred.candidate)];
    const failures: string[] = [];
    for (const { label, client: candidateClient } of ordered) {
      try {
        return (await candidateClient.request({
          method: "eth_sendRawTransaction",
          params: [signed],
        })) as Hex;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        failures.push(`${label}: ${message.replace(/\s+/g, " ").slice(0, 240)}`);
      }
    }
    throw new Error(
      `The signed transaction was broadcast to no RPC — it is NOT on-chain; retry the step. ` +
        `Broadcast failures: ${failures.join(" | ")}`,
    );
  }

  async function submit(tx: TxSubmitInput): Promise<Hex> {
    const signedChainId = tx.chainId ?? chainId;
    const primary = primaryForChain(tx.chainId);
    const candidates = candidatesFor(signedChainId, primary);
    const preflighted = await preflight(tx, candidates);
    const { nonce, gasPrice, gas } = preflighted;
    // Always sign legacy type-0 on the device (CLI parity: packages/node
    // signer.ts rebuilds typed txs before the prompt). Typed-tx signature
    // reconstruction produced invalid-signature rejections on every RPC.
    const unsignedTx = {
      chainId: signedChainId,
      nonce,
      gasPrice,
      gas,
      to: tx.to ?? undefined,
      value: tx.value ?? 0n,
      data: tx.data,
      type: "legacy" as const,
    };
    const unsignedSerialized = serializeTransaction(unsignedTx);
    input.onSigningPrompt?.(keccak256(unsignedSerialized));
    const signature = await input.signTransaction(unsignedSerialized);
    // Device v is a single byte: the full EIP-155 v for chainId 1 (fixture v:38),
    // byte-truncated for large chainIds, or 27/28. All legacy conventions share
    // "odd → yParity 0, even → yParity 1" (full v = 35 + 2c + y flips parity).
    const yParity = (signature.v + 1) & 1;
    const v = BigInt(35 + 2 * signedChainId + yParity);
    const signed = serializeTransaction(unsignedTx, { r: signature.r, s: signature.s, v });
    const hash = await broadcast(signed, preflighted, candidates);
    receiptChainByHash.set(hash, signedChainId);
    return hash;
  }

  return {
    submit,
    async waitForReceipt(hash) {
      // Poll the chain the tx was actually signed and broadcast for — the
      // configured client is only a fallback for hashes this channel didn't submit.
      const chain = receiptChainByHash.get(hash);
      const receiptClient = primaryForChain(chain).client;
      // viem's defaults (timeout 120s) give up far too early: retryCount only
      // bounds error retries, while the overall `timeout` promise governs the
      // wait — and a correctly-priced legacy tx on a congested public Sepolia
      // mempool can sit pending well past 2 minutes before mining. The tx is
      // already signed and irreversibly broadcast, so waiting longer is always
      // better than reporting a false failure; receipt polling must not fail a
      // tx that landed after the UI stopped watching.
      try {
        const receipt = await receiptClient.waitForTransactionReceipt({
          hash,
          retryCount: 90,
          retryDelay: 1000,
          pollingInterval: 2_000,
          timeout: RECEIPT_TIMEOUT_MS,
        });
        return {
          status: receipt.status === "success" ? "success" : "reverted",
          ...(receipt.contractAddress ? { contractAddress: receipt.contractAddress } : {}),
          blockNumber: receipt.blockNumber,
        };
      } catch (cause) {
        throw receiptWaitError(hash, chain, cause);
      }
    },
    async signTypedData(typedInput) {
      return input.signTypedData(typedInput.payload);
    },
  };
}
