import { afterEach, describe, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, serializeTransaction, toHex, type Hex, type PublicClient } from "viem";

import { createLedgerTxChannel, RECEIPT_TIMEOUT_MS, receiptWaitError, type DeviceTransactionSignature } from "./ledger-tx";

const perChain = vi.hoisted(() => ({
  publicClientForChainId: vi.fn(),
  chainById: vi.fn(),
}));
vi.mock("@/lib/chains", () => perChain);

const FROM = "0x1111111111111111111111111111111111111111" as const;
const TO = "0x2222222222222222222222222222222222222222" as const;
const SEPOLIA_CHAIN_ID = 11155111;

const config = {
  rpcUrl: "https://example-rpc.test",
  chainId: SEPOLIA_CHAIN_ID,
  deployments: [],
};

function fakeClient() {
  return {
    getTransactionCount: vi.fn(async () => 7),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    estimateGas: vi.fn(async () => 100_000n),
    request: vi.fn(async ({ method }: { method: string }) => {
      if (method !== "eth_sendRawTransaction") throw new Error(`unexpected method ${method}`);
      return "0xabc" as Hex;
    }),
    waitForTransactionReceipt: vi.fn(async () => ({
      status: "success",
      blockNumber: 1234n,
      contractAddress: undefined,
    })),
  };
}

/** Same client with an EIP-1559 fee estimator — viem public clients have one. */
function fakeClientWithFees() {
  return {
    ...fakeClient(),
    estimateFeesPerGas: vi.fn(async () => ({
      maxFeePerGas: 5_000_000_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
    })),
  };
}

const asPublicClient = (fake: ReturnType<typeof fakeClient>) => fake as unknown as PublicClient;

/**
 * tx-settings reads window.localStorage — in this node-env test suite the
 * window is faked the same way wallet-tx.test.ts does it. No window at all
 * means "1559 enabled" (the production default), so only the off path needs
 * the stub.
 */
function setEip1559Stored(value: string | null): void {
  (globalThis as { window?: unknown }).window = {
    localStorage: { getItem: () => value },
  };
}

// Fixed 32-byte hex helpers — the values don't need to be a real ECDSA sig;
// the channel is not expected to verify them, only serialize them verbatim.
const R = toHex(new Uint8Array(32).fill(0xab)) as Hex;
const S = toHex(new Uint8Array(32).fill(0xcd)) as Hex;

describe("createLedgerTxChannel", () => {
  it("signs on device, reconstructs EIP-155 v from the parity bit, and broadcasts raw", async () => {
    const client = fakeClient();
    const signTransaction = vi.fn(async (): Promise<DeviceTransactionSignature> => {
      // 113 = (35 + 2·11155111 + 0) mod 256 — the byte-truncated full EIP-155 v
      // the device returns for Sepolia when yParity = 0.
      return { r: R, s: S, v: 113 };
    });
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(hash).toBe("0xabc");
    // Device received the unsigned legacy serialization.
    expect(signTransaction).toHaveBeenCalledWith(serializeTransaction({
      type: "legacy",
      chainId: SEPOLIA_CHAIN_ID,
      nonce: 7,
      gasPrice: 1_000_000_000n,
      gas: 100_000n,
      to: TO,
      value: 0n,
      data: "0xdeadbeef",
    }));
    // Broadcast payload parses back with the right chainId + yParity.
    const sent = client.request.mock.calls[0][0] as unknown as { method: string; params: [Hex] };
    expect(sent.method).toBe("eth_sendRawTransaction");
    const parsed = parseTransaction(sent.params[0]);
    expect(Number(parsed.chainId)).toBe(SEPOLIA_CHAIN_ID);
    expect(parsed.yParity).toBe(0);
    expect(parsed.v).toBe(BigInt(35 + 2 * SEPOLIA_CHAIN_ID + 0));
    expect(parsed.nonce).toBe(7);
    expect(parsed.to).toBe(TO);
  });

  it("derives yParity from odd/even v across device conventions (27/28, truncated EIP-155)", async () => {
    const truncatedY0 = (35 + 2 * SEPOLIA_CHAIN_ID) % 256; // 113
    const truncatedY1 = truncatedY0 + 1; // 114
    for (const [deviceV, expectedYParity] of [
      [27, 0], [28, 1], [truncatedY0, 0], [truncatedY1, 1],
    ] as const) {
      const client = fakeClient();
      const channel = createLedgerTxChannel({
        signTransaction: async () => ({ r: R, s: S, v: deviceV }),
        signTypedData: async () => "0x",
        config,
        client: asPublicClient(client),
      });
      await channel.submit({ from: FROM, to: TO, data: "0x" });
      const sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
      const parsed = parseTransaction(sent.params[0]);
      expect(parsed.yParity, `device v=${deviceV}`).toBe(expectedYParity);
    }
  });

  it("handles contract creation (to=null) and value transfers", async () => {
    const client = fakeClient();
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    await channel.submit({ from: FROM, to: null, data: "0x6080", value: undefined });
    let sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
    expect(parseTransaction(sent.params[0]).to).toBeUndefined();

    await channel.submit({ from: FROM, to: TO, data: "0x", value: 10n ** 18n });
    sent = client.request.mock.calls[1][0] as unknown as { params: [Hex] };
    expect(parseTransaction(sent.params[0]).value).toBe(10n ** 18n);
    // estimateGas received the creation / call shape.
    expect(client.estimateGas).toHaveBeenNthCalledWith(1, expect.objectContaining({ account: FROM, data: "0x6080" }));
    expect(client.estimateGas).toHaveBeenNthCalledWith(2, expect.objectContaining({ account: FROM, to: TO, value: 10n ** 18n }));
  });

  it("fires onSigningPrompt with the keccak hash of the exact unsigned payload", async () => {
    const client = fakeClient();
    const onSigningPrompt = vi.fn();
    const unsigned = serializeTransaction({
      type: "legacy",
      chainId: SEPOLIA_CHAIN_ID,
      nonce: 7,
      gasPrice: 1_000_000_000n,
      gas: 100_000n,
      to: TO,
      value: 0n,
      data: "0xdeadbeef",
    });
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 113 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
      onSigningPrompt,
    });
    await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });
    expect(onSigningPrompt).toHaveBeenCalledExactlyOnceWith(keccak256(unsigned));
  });

  it("routes a per-tx chainId override to the per-chain client and signs for that chain", async () => {
    const client = fakeClient();
    const chainClient = fakeClient();
    perChain.publicClientForChainId.mockReturnValue(asPublicClient(chainClient));
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    await channel.submit({ from: FROM, to: null, data: "0x6080", chainId: 84532 });

    expect(perChain.publicClientForChainId).toHaveBeenCalledWith(84532);
    // Estimate/nonce/gasprice + broadcast all hit the per-chain client...
    expect(client.estimateGas).not.toHaveBeenCalled();
    expect(chainClient.estimateGas).toHaveBeenCalled();
    const sent = chainClient.request.mock.calls[0][0] as unknown as { params: [Hex] };
    // ...and the device-signed tx carries the override chainId, not the config's.
    expect(parseTransaction(sent.params[0]).chainId).toBe(84532);
  });

  it("falls back to the next RPC when the configured RPC fails pre-flight, and broadcasts on the one that answered", async () => {
    const failing = fakeClient();
    failing.estimateGas.mockRejectedValue(new Error("execution reverted for an unknown reason"));
    const fallback = fakeClient();
    const signTransaction = vi.fn(async (): Promise<DeviceTransactionSignature> => ({ r: R, s: S, v: 113 }));
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(failing),
      fallbacks: [{ label: "https://fallback-rpc.test", client: asPublicClient(fallback) }],
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(hash).toBe("0xabc");
    expect(failing.estimateGas).toHaveBeenCalled();
    expect(fallback.estimateGas).toHaveBeenCalled();
    // Device still signs once, with the fallback RPC's pre-flight values.
    expect(signTransaction).toHaveBeenCalledTimes(1);
    // Broadcast goes to the RPC that answered the pre-flight.
    expect(fallback.request).toHaveBeenCalled();
    expect(failing.request).not.toHaveBeenCalled();
  });

  it("throws one actionable error (with every RPC listed) when all pre-flights fail, and never prompts the device", async () => {
    const failing = fakeClient();
    failing.estimateGas.mockRejectedValue(new Error("execution reverted"));
    const fallback = fakeClient();
    fallback.getTransactionCount.mockRejectedValue(new Error("rate limited"));
    const signTransaction = vi.fn(async (): Promise<DeviceTransactionSignature> => ({ r: R, s: S, v: 1 }));
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(failing),
      fallbacks: [{ label: "https://fallback-rpc.test", client: asPublicClient(fallback) }],
    });

    await expect(channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" })).rejects.toThrow(
      /Could not pre-flight.*example-rpc\.test.*fallback-rpc\.test/s,
    );
    expect(signTransaction).not.toHaveBeenCalled();
  });

  it("rotates broadcast to the next RPC when the pre-flight RPC refuses the raw tx", async () => {
    const primary = fakeClient();
    primary.request.mockRejectedValue(new Error("txpool overflow"));
    const fallback = fakeClient();
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(primary),
      fallbacks: [{ label: "https://fallback-rpc.test", client: asPublicClient(fallback) }],
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });
    expect(hash).toBe("0xabc");
    expect(primary.request).toHaveBeenCalled();
    expect(fallback.request).toHaveBeenCalled();
  });

  it("waitForReceipt maps viem receipt fields to the WalletReceipt shape", async () => {
    const client = fakeClient();
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 0 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });
    const receipt = await channel.waitForReceipt("0xabc" as Hex);
    expect(receipt).toEqual({ status: "success", blockNumber: 1234n });
  });

  it("polls the receipt on the chain the tx was submitted for, not the configured RPC", async () => {
    const client = fakeClient();
    const chainClient = fakeClient();
    perChain.publicClientForChainId.mockReturnValue(asPublicClient(chainClient));
    perChain.chainById.mockReturnValue({ rpcUrl: "https://evmrpc-testnet.0g.ai" });
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    // A 0G Galileo deploy: device signs for chainId 16602, raw tx broadcast via
    // the per-chain client. The receipt MUST be polled there too.
    const hash = await channel.submit({ from: FROM, to: null, data: "0x6080", chainId: 16602 });
    const receipt = await channel.waitForReceipt(hash);

    expect(chainClient.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash, retryCount: 90 }),
    );
    // Polling the configured (Sepolia) client would hang forever on a 0G tx.
    expect(client.waitForTransactionReceipt).not.toHaveBeenCalled();
    expect(receipt.status).toBe("success");

    // An unknown hash (not submitted by this channel) falls back to the
    // configured client.
    await channel.waitForReceipt("0xunknown" as Hex);
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "0xunknown" }),
    );
  });

  it("passes an explicit long confirmation timeout to viem", async () => {
    // viem's 120s default reported false failures for txs that mined late on
    // congested public Sepolia — the retryCount does NOT extend it, the
    // `timeout` param does.
    const client = fakeClient();
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });
    await channel.waitForReceipt("0xabc" as Hex);
    expect(client.waitForTransactionReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: RECEIPT_TIMEOUT_MS }),
    );
  });

  it("wraps a confirmation timeout in a still-may-land error with the explorer link", () => {
    const timeoutError = new Error(
      'Timed out while waiting for transaction with hash "0xabc" to be confirmed.',
    );
    const wrapped = receiptWaitError("0xabc" as Hex, 11155111, timeoutError);
    expect(wrapped.message).toContain("still land");
    expect(wrapped.message).toContain("https://sepolia.etherscan.io/tx/0xabc");
    expect(wrapped.message).toContain("Original error");

    // Non-timeout failures pass through untouched.
    const other = new Error("connection reset");
    expect(receiptWaitError("0xabc" as Hex, 11155111, other)).toBe(other);

    // Unknown chain: no explorer link, but the timeout copy still applies.
    const unknownChain = receiptWaitError("0xabc" as Hex, undefined, timeoutError);
    expect(unknownChain.message).toContain("still land");
    expect(unknownChain.message).not.toContain("https://sepolia.etherscan.io");
  });

  it("surfaces a confirmation timeout as a still-may-land error through waitForReceipt", async () => {
    const client = fakeClient();
    client.waitForTransactionReceipt.mockRejectedValue(
      new Error('Timed out while waiting for transaction with hash "0xabc" to be confirmed.'),
    );
    const channel = createLedgerTxChannel({
      signTransaction: async () => ({ r: R, s: S, v: 1 }),
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });
    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    await expect(channel.waitForReceipt(hash)).rejects.toThrow(
      /still land[\s\S]*sepolia\.etherscan\.io\/tx\//,
    );
  });
});

describe("createLedgerTxChannel — EIP-1559 signing", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("signs a type-2 tx with maxFeePerGas/maxPriorityFeePerGas when the setting is on and the RPC estimates fees", async () => {
    const client = fakeClientWithFees();
    const signTransaction = vi.fn(async (unsigned: Hex): Promise<DeviceTransactionSignature> => {
      // Typed txs: the device returns v as the yParity directly.
      void unsigned;
      return { r: R, s: S, v: 1 };
    });
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(hash).toBe("0xabc");
    const parsed = parseTransaction(signTransaction.mock.calls[0]![0]);
    expect(parsed.type).toBe("eip1559");
    // maxFeePerGas padded to 2x estimate for base-fee drift tolerance; tip unchanged.
    expect(parsed.maxFeePerGas).toBe(10_000_000_000n);
    expect(parsed.maxPriorityFeePerGas).toBe(1_500_000_000n);
    expect(parsed.gasPrice).toBeUndefined();
    // Broadcast payload carries the fee fields and the device parity.
    const sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
    const broadcasted = parseTransaction(sent.params[0]);
    expect(broadcasted.type).toBe("eip1559");
    expect(broadcasted.yParity).toBe(1);
    expect(broadcasted.maxFeePerGas).toBe(10_000_000_000n);
  });

  it("falls back to a legacy tx when the device rejects the typed payload with 6a80", async () => {
    const client = fakeClientWithFees();
    let signCalls = 0;
    const signTransaction = vi.fn(async (_unsigned: Hex): Promise<DeviceTransactionSignature> => {
      signCalls += 1;
      if (signCalls === 1) throw new Error("TransportStatusError: status code 6a80 (Invalid data)");
      return { r: R, s: S, v: 27 };
    });
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(hash).toBe("0xabc");
    // The device saw two payloads: the rejected 1559 one, then the legacy one.
    expect(signTransaction).toHaveBeenCalledTimes(2);
    const secondPayload = parseTransaction(signTransaction.mock.calls[1]![0]);
    expect(secondPayload.type).toBe("legacy");
    expect(secondPayload.gasPrice).toBe(1_000_000_000n);
    // Broadcast is the signed legacy tx with a reconstructed EIP-155 v.
    const sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
    const broadcasted = parseTransaction(sent.params[0]);
    expect(broadcasted.type).toBe("legacy");
    expect(broadcasted.yParity).toBe(0);
    expect(broadcasted.v).toBe(BigInt(35 + 2 * SEPOLIA_CHAIN_ID + 0));
  });

  it("does not fall back to legacy on a user rejection — the operator said no", async () => {
    const client = fakeClientWithFees();
    const signTransaction = vi
      .fn<() => Promise<DeviceTransactionSignature>>()
      .mockRejectedValue(new Error("RefusedByUserDAError: action cancelled on device"));
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    await expect(channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" })).rejects.toThrow(
      /cancelled on device/,
    );
    expect(signTransaction).toHaveBeenCalledTimes(1);
    expect(client.request).not.toHaveBeenCalled();
  });

  it("signs legacy when the 1559 setting is off, even though the RPC estimates fees", async () => {
    setEip1559Stored("0");
    const client = fakeClientWithFees();
    const signTransaction = vi.fn(async (): Promise<DeviceTransactionSignature> => ({ r: R, s: S, v: 113 }));
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(client.estimateFeesPerGas).not.toHaveBeenCalled();
    const sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
    expect(parseTransaction(sent.params[0]).type).toBe("legacy");
  });

  it("signs legacy when the fee estimate throws — a failed estimate never fails the pre-flight", async () => {
    const client = fakeClientWithFees();
    client.estimateFeesPerGas.mockRejectedValue(new Error("eth_feeHistory unsupported"));
    const signTransaction = vi.fn(async (): Promise<DeviceTransactionSignature> => ({ r: R, s: S, v: 113 }));
    const channel = createLedgerTxChannel({
      signTransaction,
      signTypedData: async () => "0x",
      config,
      client: asPublicClient(client),
    });

    const hash = await channel.submit({ from: FROM, to: TO, data: "0xdeadbeef" });

    expect(hash).toBe("0xabc");
    const sent = client.request.mock.calls[0][0] as unknown as { params: [Hex] };
    expect(parseTransaction(sent.params[0]).type).toBe("legacy");
  });
});
