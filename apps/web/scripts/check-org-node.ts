/**
 * One-off: inspect the org ENS node on Sepolia — registry owner/resolver and the
 * SoulVault text records discovery depends on.
 * Run: pnpm exec tsx apps/web/scripts/check-org-node.ts
 */
import { createPublicClient, http, namehash, labelhash, toHex } from "viem";
import { sepolia } from "viem/chains";

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as const;

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

const registryAbi = [
  { type: "function", name: "owner", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
  { type: "function", name: "resolver", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
] as const;
const resolverAbi = [
  { type: "function", name: "text", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "string" }], outputs: [{ type: "string" }] },
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "bytes" }] },
] as const;

async function main() {
  const orgNode = namehash("soulvault-demo.eth");
  const [owner, resolver] = await Promise.all([
    client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "owner", args: [orgNode] }) as Promise<string>,
    client.readContract({ address: ENS_REGISTRY, abi: registryAbi, functionName: "resolver", args: [orgNode] }) as Promise<string>,
  ]);
  console.log(`soulvault-demo.eth  owner=${owner}  resolver=${resolver}`);

  for (const key of ["soulvault.swarms", "soulvault.treasuries", "class", "name"]) {
    const raw = (await client.readContract({
      address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: "text", args: [orgNode, key],
    })) as string;
    console.log(`  text["${key}"] = ${raw ? JSON.stringify(raw.length > 100 ? raw.slice(0, 100) + "…" : raw) : "(empty)"}`);
  }
  const eth60 = (await client.readContract({
    address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: "addr", args: [orgNode, 60n],
  })) as string;
  console.log(`  addr(_, 60) = ${eth60 === "0x" ? "(empty)" : toHex(eth60 as `0x${string}`)}`);
  // JS bitwise ops are int32 — force unsigned, or 0x80000000 | 11155111 comes out negative.
  const c60 = (0x80000000 | 11155111) >>> 0;
  const c60b = (await client.readContract({
    address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: "addr", args: [orgNode, BigInt(c60)],
  })) as string;
  console.log(`  addr(_, ${c60}) (ENSIP-11 sepolia) = ${c60b === "0x" ? "(empty)" : toHex(c60b as `0x${string}`)}`);

  const swarmNode = namehash("ops.soulvault-demo.eth");
  const swarmLabel = labelhash("ops");
  console.log(`\nops.soulvault-demo.eth  labelHash=${swarmLabel}`);
  for (const key of ["soulvault.chainId", "soulvault.swarmContract"]) {
    const raw = (await client.readContract({
      address: PUBLIC_RESOLVER, abi: resolverAbi, functionName: "text", args: [swarmNode, key],
    })) as string;
    console.log(`  text["${key}"] = ${raw ? JSON.stringify(raw) : "(empty)"}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
