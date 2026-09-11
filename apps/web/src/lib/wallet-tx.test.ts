import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hex } from "viem";

import { sendWalletTransaction, asHex, ledgerSignature, yParityFromV } from "./wallet-tx";

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
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    getTransactionCount: vi.fn(async () => 7),
    sendRawTransaction: vi.fn(async () => "0xabc"),
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
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    getTransactionCount: vi.fn(async () => 7),
    sendRawTransaction: vi.fn(async () => "0xabc"),
  })),
}));

type SendParams = Record<string, unknown>;

type WindowWithEthereum = { window?: { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } } };

function globalAsWindow(): WindowWithEthereum {
  return globalThis as unknown as WindowWithEthereum;
}

const WC_GAS_PRICE_ERROR = Object.assign(
  new Error(
    "RPC Request failed. URL: https://rpc.walletconnect.org/v1/?chainId=eip155%3A11155111 Details: chain is not available on free plan, please upgrade to paid plan",
  ),
  { code: -32603 },
);

function injectWallet(handlers: {
  signTransaction?: (params: SendParams) => Promise<string>;
  sendTransaction?: (params: SendParams) => Promise<Hex>;
} = {}) {
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === "eth_requestAccounts") return [FROM];
    if (method === "eth_chainId") return "0xaa36a7";
    if (method === "wallet_addEthereumChain") return null;
    if (method === "wallet_switchEthereumChain") return null;
    if (
      method === "eth_gasPrice" ||
      method === "eth_estimateGas" ||
      method === "eth_getTransactionCount" ||
      method === "eth_feeHistory" ||
      method === "eth_maxPriorityFeePerGas"
    ) {
      throw WC_GAS_PRICE_ERROR;
    }
    if (method === "eth_signTransaction") {
      if (handlers.signTransaction) return handlers.signTransaction(params![0] as SendParams);
      return `0x${"ab".repeat(80)}`;
    }
    if (method === "eth_sendTransaction") {
      if (handlers.sendTransaction) return handlers.sendTransaction(params![0] as SendParams);
      throw new Error("eth_sendTransaction should not be required when sign+raw works");
    }
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

  it("signs a fully prepared tx and broadcasts via the dashboard RPC", async () => {
    let signed: SendParams | undefined;
    const request = injectWallet({
      signTransaction: async (params) => {
        signed = params;
        return `0x${"ab".repeat(80)}`;
      },
    });

    const hash = await sendWalletTransaction({ from: FROM, to: null, data: "0x6080" });
    expect(hash).toBe("0xabc");
    expect(signed?.gas).toBe("0x3039");
    expect(signed?.gasPrice).toBe("0x3b9aca00");
    expect(signed?.nonce).toBe("0x7");
    expect(signed?.to).toBeUndefined();
    expect(request.mock.calls.map((c) => c[0].method)).not.toContain("eth_sendTransaction");
    expect(request.mock.calls.map((c) => c[0].method)).not.toContain("eth_gasPrice");
  });

  it("never asks the wallet for gasPrice/nonce/estimate (WalletConnect-dead RPC)", async () => {
    const request = injectWallet();
    await sendWalletTransaction({ from: FROM, to: null, data: "0x6080", chainId: 11155111 });
    const methods = request.mock.calls.map((c) => c[0].method);
    expect(methods).not.toContain("eth_gasPrice");
    expect(methods).not.toContain("eth_estimateGas");
    expect(methods).not.toContain("eth_getTransactionCount");
    expect(methods).toContain("eth_signTransaction");
  });

  it("throws if the dashboard RPC cannot prepare nonce/gas/gasPrice", async () => {
    const { createSoulVaultPublicClient } = await import("@/lib/onchain/client");
    vi.mocked(createSoulVaultPublicClient).mockImplementationOnce(() => ({
      estimateGas: vi.fn(async () => {
        throw new Error("rpc down");
      }),
      getGasPrice: vi.fn(async () => 1_000_000_000n),
      getTransactionCount: vi.fn(async () => 7),
      sendRawTransaction: vi.fn(async () => "0xabc"),
    }) as never);

    injectWallet();
    await expect(sendWalletTransaction({ from: FROM, to: null, data: "0x6080" })).rejects.toThrow(
      /Could not prepare the transaction against the dashboard RPC/,
    );
  });

  it("maps WalletConnect free-plan RPC failures to a Sepolia RPC hint", async () => {
    injectWallet({
      signTransaction: async () => {
        throw WC_GAS_PRICE_ERROR;
      },
      sendTransaction: async () => {
        throw WC_GAS_PRICE_ERROR;
      },
    });

    await expect(sendWalletTransaction({ from: FROM, to: null, data: "0x6080" })).rejects.toThrow(
      /WalletConnect/,
    );
  });

  it("wraps a wallet estimation failure with app-side context when the app estimate succeeded", async () => {
    const walletError = Object.assign(
      new Error("Execution reverted for an unknown reason. Estimate Gas Arguments: from: ... Version: viem@2.47.10"),
      { code: -32603 },
    );
    injectWallet({
      signTransaction: async () => {
        throw walletError;
      },
    });

    await expect(sendWalletTransaction({ from: FROM, to: null, data: "0x6080" })).rejects.toThrow(
      /pre-estimated 12345 gas successfully/,
    );
  });

  it("falls back to eth_sendTransaction when eth_signTransaction is unsupported", async () => {
    let sent: SendParams | undefined;
    const request = injectWallet({
      signTransaction: async () => {
        throw Object.assign(new Error("Method eth_signTransaction is not supported"), { code: -32601 });
      },
      sendTransaction: async (params) => {
        sent = params;
        return "0xdef" as Hex;
      },
    });

    const hash = await sendWalletTransaction({ from: FROM, to: null, data: "0x6080" });
    expect(hash).toBe("0xdef");
    expect(sent?.gasPrice).toBe("0x3b9aca00");
    expect(request.mock.calls.map((c) => c[0].method)).toContain("eth_sendTransaction");
  });

  it("pins the dashboard RPC then switches to the target chain", async () => {
    const requests: string[] = [];
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      requests.push(method);
      if (method === "eth_requestAccounts") return [FROM];
      if (method === "eth_chainId") return "0xaa36a7";
      if (method === "wallet_addEthereumChain") return null;
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_signTransaction") return `0x${"ab".repeat(80)}`;
      throw new Error(`unexpected method ${method}`);
    });
    (globalThis as WindowWithEthereum).window = { ethereum: { request } };

    await sendWalletTransaction({ from: FROM, to: null, data: "0x", chainId: 84532 });

    expect(requests).toEqual([
      "eth_requestAccounts",
      "wallet_addEthereumChain",
      "eth_chainId",
      "wallet_switchEthereumChain",
      "eth_signTransaction",
    ]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x14a34" }],
      }),
    );
    const addCall = request.mock.calls.find((c) => c[0].method === "wallet_addEthereumChain");
    const addParams = addCall![0].params![0] as Record<string, unknown>;
    expect(addParams.chainId).toBe("0x14a34");
    expect(addParams.rpcUrls).toEqual(["https://test-rpc.example"]);
  });

  it("does not touch the wallet network when no chainId is given", async () => {
    const request = injectWallet();
    await sendWalletTransaction({ from: FROM, to: null, data: "0x" });
    const methods = request.mock.calls.map((c) => c[0].method);
    expect(methods).not.toContain("eth_chainId");
    expect(methods).not.toContain("wallet_switchEthereumChain");
    expect(methods).not.toContain("wallet_addEthereumChain");
  });
});

describe("ledger signature helpers", () => {
  it("maps Ledger v values onto yParity", () => {
    expect(yParityFromV(0)).toBe(0);
    expect(yParityFromV(27)).toBe(0);
    expect(yParityFromV(1)).toBe(1);
    expect(yParityFromV(28)).toBe(1);
    expect(yParityFromV(37)).toBe(0);
    expect(yParityFromV(38)).toBe(1);
  });

  it("normalizes r/s without requiring a 0x prefix", () => {
    const sig = ledgerSignature({
      r: "11".repeat(32),
      s: "22".repeat(32),
      v: 28,
    });
    expect(sig.r).toBe(asHex("11".repeat(32)));
    expect(sig.s).toBe(asHex("22".repeat(32)));
    expect(sig.yParity).toBe(1);
  });
});
