import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { anvilBin, startAnvil, type AnvilHandle } from "./foundry-anvil";
import { ANVIL_ACCOUNT0, createFoundryProvider, installFoundryProvider } from "./foundry-provider";
import { sendWalletTransaction, waitForWalletReceipt } from "./wallet-tx";

const hasAnvil = existsSync(anvilBin());

describe.skipIf(!hasAnvil)("foundry injected provider", () => {
  let anvil: AnvilHandle;

  beforeAll(async () => {
    anvil = await startAnvil();
    process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL = anvil.rpcUrl;
    process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID = String(anvil.chainId);
    installFoundryProvider(
      createFoundryProvider({ rpcUrl: anvil.rpcUrl, chainId: anvil.chainId, privateKey: ANVIL_ACCOUNT0.privateKey }),
    );
  }, 30_000);

  afterAll(() => {
    anvil?.stop();
  });

  it("sends a tx without calling WalletConnect", async () => {
    const hash = await sendWalletTransaction({
      from: ANVIL_ACCOUNT0.address,
      to: ANVIL_ACCOUNT0.address,
      data: "0x",
      chainId: 31337,
    });
    expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    const receipt = await waitForWalletReceipt(hash);
    expect(receipt.status).toBe("success");
    expect(receipt.blockNumber).toBeGreaterThan(0n);
  });
});
