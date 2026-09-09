/**
 * Ledger transaction channel: signs each transaction on the DMK device session
 * and broadcasts the raw signed tx straight to the configured RPC — no injected
 * wallet involvement, so the dashboard can create treasuries/swarms with only a
 * Ledger connected.
 *
 * Mirrors the CLI's LedgerEthersSigner path (packages/node/src/signer.ts):
 * - legacy type-0 txs (the Ledger Ethereum app frequently rejects typed-tx
 *   payloads with 6a80 "Invalid data"),
 * - the device's signature `v` byte read as a parity bit and the full EIP-155
 *   `v` reconstructed (the device returns one byte; Sepolia's v ≈ 22.3M cannot
 *   fit, and 27/28 vs 0/1 conventions differ between app versions).
 */
import { hexToBytes, keccak256, serializeTransaction, type Address, type Hex, type PublicClient } from "viem";

import { createSoulVaultPublicClient, type SoulVaultClientConfig } from "@/lib/onchain/client";
import type { TxChannel, TxSubmitInput } from "@/lib/wallet-tx";

export type DeviceTransactionSignature = { r: Hex; s: Hex; v: number };

/** Minimal viem public-client surface used by the Ledger channel. */
type LedgerRpcClient = {
  getTransactionCount(args: { address: Address }): Promise<number>;
  getGasPrice(): Promise<bigint>;
  estimateGas(args: { account: Address; to?: Address; data: Hex; value?: bigint }): Promise<bigint>;
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{
    status: string;
    blockNumber: bigint;
    contractAddress?: Address | null;
  }>;
};

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
}): TxChannel {
  const client = (input.client ?? createSoulVaultPublicClient(input.config)) as LedgerRpcClient;
  const chainId = input.config.chainId;

  async function submit(tx: TxSubmitInput): Promise<Hex> {
    const [nonce, gasPrice, gas] = await Promise.all([
      client.getTransactionCount({ address: tx.from }),
      client.getGasPrice(),
      client.estimateGas({
        account: tx.from,
        ...(tx.to !== null ? { to: tx.to } : {}),
        data: tx.data,
        ...(tx.value !== undefined ? { value: tx.value } : {}),
      }),
    ]);
    // Legacy type-0 with a single gasPrice — same workaround as the CLI signer.
    const unsignedTx = {
      type: "legacy" as const,
      chainId,
      nonce,
      gasPrice,
      gas,
      to: tx.to ?? undefined,
      value: tx.value ?? 0n,
      data: tx.data,
    };
    const unsignedSerialized = serializeTransaction(unsignedTx);
    input.onSigningPrompt?.(keccak256(unsignedSerialized));
    const signature = await input.signTransaction(unsignedSerialized);
    // Device v is a single byte: the full EIP-155 v for chainId 1 (fixture v:38),
    // byte-truncated for large chainIds, or 27/28. All legacy conventions share
    // "odd → yParity 0, even → yParity 1" (full v = 35 + 2c + y flips parity).
    const yParity = (signature.v + 1) & 1;
    const v = BigInt(35 + 2 * chainId + yParity);
    const signed = serializeTransaction(unsignedTx, { r: signature.r, s: signature.s, v });
    return (await client.request({ method: "eth_sendRawTransaction", params: [signed] })) as Hex;
  }

  return {
    submit,
    async waitForReceipt(hash) {
      const receipt = await client.waitForTransactionReceipt({ hash });
      return {
        status: receipt.status === "success" ? "success" : "reverted",
        ...(receipt.contractAddress ? { contractAddress: receipt.contractAddress } : {}),
        blockNumber: receipt.blockNumber,
      };
    },
    async signTypedData(typedInput) {
      return input.signTypedData(typedInput.payload);
    },
  };
}
