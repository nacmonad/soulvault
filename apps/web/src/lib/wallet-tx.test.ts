import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import { sendWalletTransaction } from "./wallet-tx";

const FROM = "0x1111111111111111111111111111111111111111" as const;

const config = {
  rpcUrl: "https://example-rpc.test",
  chainId: 11155111,
  deployments: [],
};

vi.mock("@/lib/onchain/client", () => ({
  getBrowserSoulVaultClientConfig: vi.fn(() => config),
  createSoulVaultPublicClient: vi.fn(() => ({
    estimateGas: vi.fn(async () => 12345n),
  })),
}));

type SendParams = Record<string, unknown>;

type WindowWithEthereum = { window?: { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } };

function globalAsWindow(): WindowWithEthereum {
  return globalThis as unknown as WindowWithEthereum;
}

function injectWallet(handlers: { sendTransaction: (params: SendParams) => Promise<Hex> }) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_requestAccounts") return [FROM];
    if (method === "eth_sendTransaction") return handlers.sendTransaction(params![0] as SendParams);
    if (method === "eth_getTransactionReceipt") {
      return { status: "0x1", contractAddress: FROM, blockNumber: "0x1" };
    }
    throw new Error(`unexpected method ${method}`);
  });
  globalAsWindow().window = { ethereum: { request } };
  return request;
}

describe("browser channel gas pre-estimation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete globalAsWindow().window;
  });

  it("passes the app-side estimate as explicit gas so the wallet skips its own estimator", async () => {
    let sent: SendParams | undefined;
    injectWallet({ sendTransaction: async (params) => { sent = params; return "0xabc" as Hex; } });

    const hash = await sendWalletTransaction({ from: FROM, to: null, data: "0x6080" });
    expect(hash).toBe("0xabc");
    expect(sent?.gas).toBe("0x3039");
    expect(sent?.to).toBeUndefined();
  });

  it("omits gas when the app-side estimate fails, falling back to wallet estimation", async () => {
    const { createSoulVaultPublicClient } = await import("@/lib/onchain/client");
    vi.mocked(createSoulVaultPublicClient).mockImplementationOnce(() => ({
      estimateGas: vi.fn(async () => { throw new Error("rpc down"); }),
    }) as never);

    let sent: SendParams | undefined;
    injectWallet({ sendTransaction: async (params) => { sent = params; return "0xabc" as Hex; } });

    await sendWalletTransaction({ from: FROM, to: null, data: "0x6080" });
    expect(sent?.gas).toBeUndefined();
  });
});
