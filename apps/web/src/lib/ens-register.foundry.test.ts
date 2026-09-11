import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, zeroHash } from "viem";

import { anvilBin, startAnvil, type AnvilHandle } from "./foundry-anvil";
import { ANVIL_ACCOUNT0, createFoundryProvider, installFoundryProvider } from "./foundry-provider";
import {
  checkEnsNameAvailability,
  CONTROLLER_ABI,
  ONE_YEAR_SECONDS,
  quoteRegistration,
} from "./ens-register";
import { ETH_REGISTRAR_CONTROLLER, PUBLIC_RESOLVER } from "./ens-writes";
import { sendWalletTransaction, waitForWalletReceipt } from "./wallet-tx";
import { createSoulVaultPublicClient } from "./onchain/client";

const FORK_URL = process.env.SOULVAULT_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const hasAnvil = existsSync(anvilBin());
const runFork = hasAnvil && process.env.SOULVAULT_FOUNDRY_FORK === "1";

describe.skipIf(!runFork)("org ENS commit on anvil Sepolia fork", () => {
  let anvil: AnvilHandle;

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: FORK_URL, chainId: 11155111 });
    process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL = anvil.rpcUrl;
    process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID = "11155111";
    installFoundryProvider(
      createFoundryProvider({ rpcUrl: anvil.rpcUrl, chainId: 11155111, privateKey: ANVIL_ACCOUNT0.privateKey }),
    );
  }, 90_000);

  afterAll(() => {
    anvil?.stop();
  });

  it("commits a new .eth name through the foundry provider", async () => {
    const ensName = `svt${Date.now()}.eth`;
    const availability = await checkEnsNameAvailability(ensName);
    expect(availability.available).toBe(true);
    await quoteRegistration(availability.label);
    const registration = {
      label: availability.label,
      owner: ANVIL_ACCOUNT0.address,
      duration: ONE_YEAR_SECONDS,
      secret: ("0x" + "11".repeat(32)) as `0x${string}`,
      resolver: PUBLIC_RESOLVER,
      data: [] as `0x${string}`[],
      reverseRecord: 0,
      referrer: zeroHash,
    };
    const client = createSoulVaultPublicClient({
      rpcUrl: anvil.rpcUrl,
      chainId: 11155111,
      deployments: [],
    });
    const commitment = await client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "makeCommitment",
      args: [registration],
    });
    const hash = await sendWalletTransaction({
      from: ANVIL_ACCOUNT0.address,
      to: ETH_REGISTRAR_CONTROLLER,
      data: encodeFunctionData({
        abi: CONTROLLER_ABI,
        functionName: "commit",
        args: [commitment],
      }),
      chainId: 11155111,
    });
    const receipt = await waitForWalletReceipt(hash);
    expect(receipt.status).toBe("success");
    const storedAt = await client.readContract({
      address: ETH_REGISTRAR_CONTROLLER,
      abi: CONTROLLER_ABI,
      functionName: "commitments",
      args: [commitment],
    });
    expect(storedAt).toBeGreaterThan(0n);
  }, 60_000);
});
