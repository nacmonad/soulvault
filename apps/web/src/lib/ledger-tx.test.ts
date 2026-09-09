import { describe, expect, it, vi } from "vitest";
import { keccak256, parseTransaction, serializeTransaction, toHex, type Hex, type PublicClient } from "viem";

import { createLedgerTxChannel, type DeviceTransactionSignature } from "./ledger-tx";

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

const asPublicClient = (fake: ReturnType<typeof fakeClient>) => fake as unknown as PublicClient;

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
});
