import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, createWalletClient, http, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { FullConfig } from "@playwright/test";

/**
 * e2e global setup (ticket 006).
 *
 * 1. Verifies the local anvil/ens-app-v3 node is reachable and on the expected
 *    chain id — the suite never starts a chain of its own.
 * 2. Ensures the Foundry artifact for SoulVaultDocumentRegistry exists
 *    (runs `forge build` when missing).
 * 3. Deploys a fresh SoulVaultDocumentRegistry with the Alice key and exports
 *    its address to the workers via process.env.
 *
 * Alice and Mallory are deterministic Anvil accounts (pre-funded on any
 * Anvil-launched chain). Charlie is the emulated Ledger — he never spends
 * gas (attest is an EIP-712 signature; rehydrate is local compute), so no
 * funding is required for him.
 */

const ANVIL_ALICE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil account[1]
const ANVIL_MALLORY_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"; // anvil account[2]

export const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const stateDir = path.join(repoRoot, "apps/web/e2e/.state");

export default async function globalSetup(_config: FullConfig) {
  const rpcUrl = process.env.SOULVAULT_E2E_RPC_URL || "http://127.0.0.1:8545";
  const expectedChainId = Number(process.env.SOULVAULT_E2E_CHAIN_ID || 1337);

  const chain: Chain = {
    id: expectedChainId,
    name: "soulvault-e2e-local",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  };
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (cause) {
    throw new Error(
      `e2e requires a local Anvil/ens-app-v3 node at ${rpcUrl} — could not reach it.\n` +
        `Start the node (see .env.test.example), then re-run.\n(${String(cause)})`,
    );
  }
  if (chainId !== expectedChainId) {
    throw new Error(`e2e node chainId ${chainId} != expected ${expectedChainId} at ${rpcUrl}`);
  }

  // Funded-account sanity: Alice and Mallory come pre-funded from Anvil's
  // default mnemonic; fail loudly instead of mysteriously mid-test.
  for (const [label, key] of [["alice", ANVIL_ALICE_KEY], ["mallory", ANVIL_MALLORY_KEY]] as const) {
    const balance = await client.getBalance({ address: privateKeyToAccount(key).address });
    if (balance === 0n) {
      throw new Error(`e2e account "${label}" (${privateKeyToAccount(key).address}) has no balance on ${rpcUrl}.`);
    }
  }

  const artifactPath = path.join(repoRoot, "out", "SoulVaultDocumentRegistry.sol", "SoulVaultDocumentRegistry.json");
  if (!fs.existsSync(artifactPath)) {
    execFileSync("forge", ["build"], { cwd: repoRoot, stdio: "inherit" });
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { bytecode: { object?: string } };
  const bytecode = artifact.bytecode?.object;
  if (!bytecode || bytecode === "0x") throw new Error(`SoulVaultDocumentRegistry artifact has no bytecode (${artifactPath})`);

  const alice = privateKeyToAccount(ANVIL_ALICE_KEY);
  const aliceWallet = createWalletClient({ account: alice, chain, transport: http(rpcUrl) });
  const deployTx = await aliceWallet.sendTransaction({ account: alice, data: `0x${bytecode.replace(/^0x/, "")}` as `0x${string}` });
  const receipt = await client.waitForTransactionReceipt({ hash: deployTx });
  const registryAddress = receipt.contractAddress as Address | null;
  if (!registryAddress) throw new Error("Registry deploy receipt has no contractAddress");

  fs.rmSync(stateDir, { recursive: true, force: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(
    path.join(stateDir, "deployment.json"),
    `${JSON.stringify({ registryAddress, rpcUrl, chainId }, null, 2)}\n`,
  );

  // Worker-visible env (documented Playwright globalSetup behavior).
  process.env.SOULVAULT_E2E_REGISTRY_ADDRESS = registryAddress;
  process.env.SOULVAULT_E2E_RPC_URL = rpcUrl;
  process.env.SOULVAULT_E2E_CHAIN_ID = String(chainId);
  process.env.SOULVAULT_E2E_ALICE_KEY = ANVIL_ALICE_KEY;
  process.env.SOULVAULT_E2E_MALLORY_KEY = ANVIL_MALLORY_KEY;
  process.env.SOULVAULT_E2E_STATE_DIR = stateDir;
}
