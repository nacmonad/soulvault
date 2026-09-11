import { describe, expect, it } from "vitest";

const SEPOLIA_RPC = "https://ethereum-sepolia-rpc.publicnode.com";

describe("dashboard Sepolia RPC", () => {
  it("serves eth_gasPrice so the app can fill fees without WalletConnect", async () => {
    const response = await fetch(SEPOLIA_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    });
    expect(response.ok).toBe(true);
    const body = (await response.json()) as { result?: string; error?: { message: string } };
    expect(body.error).toBeUndefined();
    expect(body.result).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(BigInt(body.result!)).toBeGreaterThan(0n);
  });
});
