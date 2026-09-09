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

vi.mock("@/lib/chains", () => ({
  SEPOLIA_CHAIN_ID: 11155111,
  WIZARD_CHAINS: [],
  chainById: (id: number) => ({
    id,
    name: "Test Chain",
    label: "Test Chain",
    rpcUrl: "https://test-rpc.example",
    currency: { name: "Ether", symbol: "ETH", decimals: 18 },
    explorer: "https://explorer.example",
  }),
  publicClientForChainId: vi.fn(() => ({
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

  it("wraps a wallet estimation failure with app-side context when the app estimate succeeded", async () => {
    const walletError = Object.assign(
      new Error("Execution reverted for an unknown reason. Estimate Gas Arguments: from: ... Version: viem@2.47.10"),
      { code: -32603 },
    );
    injectWallet({
      sendTransaction: async () => {
        throw walletError;
      },
    });

    await expect(sendWalletTransaction({ from: FROM, to: null, data: "0x6080" })).rejects.toThrow(
      /pre-estimated 12345 gas successfully/,
    );
  });

  it("wraps wallet estimation failures with rpc guidance when the app-side estimate failed too", async () => {
    const { createSoulVaultPublicClient } = await import("@/lib/onchain/client");
    vi.mocked(createSoulVaultPublicClient).mockImplementationOnce(() => ({
      estimateGas: vi.fn(async () => { throw new Error("rpc down"); }),
    }) as never);

    injectWallet({
      sendTransaction: async () => {
        throw Object.assign(new Error("execution reverted"), { code: -32603 });
      },
    });

    await expect(sendWalletTransaction({ from: FROM, to: null, data: "0x6080" })).rejects.toThrow(
      /could not pre-estimate/,
    );
  });

  it("switches the wallet to the target chain before sending", async () => {
    const requests: string[] = [];
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      requests.push(method);
      if (method === "eth_requestAccounts") return [FROM];
      if (method === "eth_chainId") return "0xaa36a7"; // Sepolia
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") return "0xabc" as Hex;
      if (method === "eth_getTransactionReceipt") {
        return { status: "0x1", contractAddress: FROM, blockNumber: "0x1" };
      }
      throw new Error(`unexpected method ${method}`);
    });
    (globalThis as WindowWithEthereum).window = { ethereum: { request } };

    await sendWalletTransaction({ from: FROM, to: null, data: "0x", chainId: 84532 });

    // switch (via switchEthereumChain) happens before the send; no add needed.
    expect(requests).toEqual([
      "eth_requestAccounts",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_sendTransaction",
    ]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x14a34" }],
      }),
    );
  });

  it("adds an unknown chain after a 4902 switch rejection", async () => {
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_requestAccounts") return [FROM];
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "wallet_switchEthereumChain") {
        throw Object.assign(new Error("Unrecognized chain."), { code: 4902 });
      }
      if (method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") return "0xabc" as Hex;
      if (method === "eth_getTransactionReceipt") {
        return { status: "0x1", contractAddress: FROM, blockNumber: "0x1" };
      }
      throw new Error(`unexpected method ${method}`);
    });
    (globalThis as WindowWithEthereum).window = { ethereum: { request } };

    await sendWalletTransaction({ from: FROM, to: null, data: "0x", chainId: 84532 });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "wallet_addEthereumChain" }),
    );
    const addCall = request.mock.calls.find((c) => c[0].method === "wallet_addEthereumChain");
    expect(addCall).toBeDefined();
    const addParams = addCall![0].params![0] as Record<string, unknown>;
    expect(addParams.chainId).toBe("0x14a34");
    expect((addParams.nativeCurrency as { symbol: string }).symbol).toBe("ETH");
  });

  it("does not touch the wallet network when no chainId is given", async () => {
    const requests: string[] = [];
    injectWallet({
      sendTransaction: async (params) => {
        void params;
        return "0xabc" as Hex;
      },
    });
    // Re-wrap the injected request to record method order.
    const eth = (globalThis as WindowWithEthereum).window!.ethereum!;
    const original = eth.request.bind(eth);
    eth.request = (async (args: { method: string }) => {
      requests.push(args.method);
      return original(args);
    }) as typeof eth.request;

    await sendWalletTransaction({ from: FROM, to: null, data: "0x" });
    expect(requests).not.toContain("eth_chainId");
    expect(requests).not.toContain("wallet_switchEthereumChain");
  });
});
