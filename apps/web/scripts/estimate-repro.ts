/**
 * Repro: estimate the exact swarm-creation tx the wizard builds, against the
 * same RPC the app uses (publicnode Sepolia). Compare with the failing
 * MetaMask-side estimation.
 */
import { createPublicClient, http, encodeFunctionData, type Hex } from "viem";

import { SWARM_ARTIFACT } from "../src/lib/contracts-artifacts";

const FROM = "0x56C528C96D19bd88844fb608035f4c745f25287b";
const TREASURY = "0x315CaF1C715d87631172cF7Adf3730eed5383817";
const RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://1rpc.io/sepolia",
  "https://endpoints.omniatech.io/v1/eth/sepolia/public",
];

const creationData = (
  SWARM_ARTIFACT.bytecode +
  encodeFunctionData({
    abi: [
      {
        type: "function",
        name: "init",
        stateMutability: "nonpayable",
        inputs: [{ name: "initialTreasury", type: "address" }],
      },
    ],
    args: [TREASURY],
  }).slice(10)
) as Hex;

async function main() {
  console.log("payload bytes:", (creationData.length - 2) / 2);
  for (const rpcUrl of RPCS) {
    const client = createPublicClient({ transport: http(rpcUrl) });
    try {
      const gas = await client.estimateGas({ account: FROM, data: creationData });
      console.log(`OK   ${rpcUrl}: gas = ${gas}`);
    } catch (e) {
      console.log(`FAIL ${rpcUrl}:`, e instanceof Error ? e.message.slice(0, 400) : e);
    }
  }
}

main();
