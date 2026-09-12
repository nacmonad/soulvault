import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress, type Address } from "viem";

import { anvilBin, startAnvil, type AnvilHandle } from "./foundry-anvil";
import { ANVIL_ACCOUNT0, createFoundryProvider, installFoundryProvider } from "./foundry-provider";
import {
  checkEnsNameAvailability,
  ORG_ENS_CLASS_VALUE,
  registerOrganizationEns,
} from "./ens-register";
import {
  ETH_REGISTRAR_CONTROLLER,
  ENS_REGISTRY,
  PUBLIC_RESOLVER,
  REGISTRY_ABI,
  RESOLVER_ABI,
  namehash,
} from "./ens-writes";
import { createSoulVaultPublicClient } from "./onchain/client";

const FORK_URL = process.env.SOULVAULT_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";
const hasAnvil = existsSync(anvilBin());
const runFork = hasAnvil && process.env.SOULVAULT_FOUNDRY_FORK === "1";

/** Sepolia BaseRegistrar — `controllers(ETH_REGISTRAR_CONTROLLER)` is currently false. */
const BASE_REGISTRAR = getAddress("0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85");

const BASE_REGISTRAR_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "addController",
    stateMutability: "nonpayable",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "controllers",
    stateMutability: "view",
    inputs: [{ name: "controller", type: "address" }],
    outputs: [{ type: "bool" }],
  },
] as const;

async function anvilRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? method);
  return body.result;
}

/** V1 register is disabled on Sepolia; re-authorize the controller on the fork. */
async function authorizeEthRegistrarController(rpcUrl: string): Promise<void> {
  const client = createSoulVaultPublicClient({ rpcUrl, chainId: 11155111, deployments: [] });
  const owner = await client.readContract({
    address: BASE_REGISTRAR,
    abi: BASE_REGISTRAR_ABI,
    functionName: "owner",
  });
  await anvilRpc(rpcUrl, "anvil_setBalance", [owner, "0x56bc75e2d63100000"]);
  await anvilRpc(rpcUrl, "anvil_impersonateAccount", [owner]);
  const hash = await anvilRpc(rpcUrl, "eth_sendTransaction", [
    {
      from: owner,
      to: BASE_REGISTRAR,
      data: encodeFunctionData({
        abi: BASE_REGISTRAR_ABI,
        functionName: "addController",
        args: [ETH_REGISTRAR_CONTROLLER],
      }),
    },
  ]);
  if (typeof hash !== "string") throw new Error("addController did not return a tx hash");
  const enabled = await client.readContract({
    address: BASE_REGISTRAR,
    abi: BASE_REGISTRAR_ABI,
    functionName: "controllers",
    args: [ETH_REGISTRAR_CONTROLLER],
  });
  if (!enabled) throw new Error("BaseRegistrar.controllers(controller) is still false after addController");
}

/** Anvil account0 carries EIP-7702 code on this Sepolia fork; `.transfer()` refunds OOG. */
async function clearAccountCode(rpcUrl: string, address: Address): Promise<void> {
  await anvilRpc(rpcUrl, "anvil_setCode", [address, "0x"]);
  await anvilRpc(rpcUrl, "anvil_setBalance", [address, "0x21e19e0c9bab2400000"]);
}

describe.skipIf(!runFork)("org ENS register on anvil Sepolia fork", () => {
  let anvil: AnvilHandle;

  beforeAll(async () => {
    anvil = await startAnvil({ forkUrl: FORK_URL, chainId: 11155111 });
    process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL = anvil.rpcUrl;
    process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID = "11155111";
    await authorizeEthRegistrarController(anvil.rpcUrl);
    await clearAccountCode(anvil.rpcUrl, ANVIL_ACCOUNT0.address);
    installFoundryProvider(
      createFoundryProvider({ rpcUrl: anvil.rpcUrl, chainId: 11155111, privateKey: ANVIL_ACCOUNT0.privateKey }),
    );
  }, 90_000);

  afterAll(() => {
    anvil?.stop();
  });

  it("commits, registers, and writes org metadata through the foundry provider", async () => {
    const ensName = `svt${Date.now()}.eth`;
    const availability = await checkEnsNameAvailability(ensName);
    expect(availability.available).toBe(true);

    const result = await registerOrganizationEns({
      from: ANVIL_ACCOUNT0.address,
      displayName: "Fork Org",
      ensName,
      onStep: () => {},
    });

    expect(result.commitTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.registerTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.classTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.nameTxHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

    const client = createSoulVaultPublicClient({
      rpcUrl: anvil.rpcUrl,
      chainId: 11155111,
      deployments: [],
    });
    const node = namehash(ensName);
    const owner = await client.readContract({
      address: ENS_REGISTRY,
      abi: REGISTRY_ABI,
      functionName: "owner",
      args: [node],
    });
    expect(owner.toLowerCase()).toBe(ANVIL_ACCOUNT0.address.toLowerCase());

    const classValue = await client.readContract({
      address: PUBLIC_RESOLVER,
      abi: RESOLVER_ABI,
      functionName: "text",
      args: [node, "class"],
    });
    expect(classValue).toBe(ORG_ENS_CLASS_VALUE);
  }, 90_000);
});
