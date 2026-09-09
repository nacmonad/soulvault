/**
 * Test batch-error attribution: in the browser, the ledger channel's estimate
 * is batched (viem default, wait: 0) with concurrent dashboard polling calls.
 * If publicnode collapses a batch containing one failing sibling into a single
 * JSON-RPC error object (not an array), viem attributes that error to ALL
 * items — including our estimate, which would render as
 * "Execution reverted for an unknown reason".
 */
import { createPublicClient, http, encodeFunctionData, type Hex } from "viem";

import { SWARM_ARTIFACT } from "../src/lib/contracts-artifacts";

const FROM = "0x56C528C96D19bd88844fb608035f4c745f25287b";
const TREASURY = "0x315CaF1C715d87631172cF7Adf3730eed5383817";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

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

const estimate = (id: number) => ({
  jsonrpc: "2.0",
  id,
  method: "eth_estimateGas",
  params: [{ from: FROM, data: creationData }],
});

async function post(body: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  // Sibling candidates the dashboard could have in flight alongside the estimate.

  // a) A reverting eth_call (call a function that doesn't exist on the swarm contract).
  const revertingCall = {
    jsonrpc: "2.0",
    id: 2,
    method: "eth_call",
    params: [{ from: FROM, to: TREASURY, data: "0xdeadbeef" }, "latest"],
  };

  // b) A getLogs with a huge block range (typical unbounded watcher query).
  const wideLogs = {
    jsonrpc: "2.0",
    id: 3,
    method: "eth_getLogs",
    params: [{ fromBlock: "0x0", topics: [] }],
  };

  // a) estimate + reverting sibling
  let r = await post([estimate(1), revertingCall]);
  console.log("[batch: estimate + reverting eth_call]", `HTTP ${r.status}:`, r.text.slice(0, 500), "\n");

  // b) estimate + wide getLogs
  r = await post([estimate(1), wideLogs]);
  console.log("[batch: estimate + unbounded getLogs]", `HTTP ${r.status}:`, r.text.slice(0, 500), "\n");

  // c) sibling alone — what does the failing sibling's error look like?
  r = await post([revertingCall]);
  console.log("[sibling eth_call alone]", `HTTP ${r.status}:`, r.text.slice(0, 300), "\n");

  // d) wide getLogs alone
  r = await post([wideLogs]);
  console.log("[wide getLogs alone]", `HTTP ${r.status}:`, r.text.slice(0, 300), "\n");
}

main();
