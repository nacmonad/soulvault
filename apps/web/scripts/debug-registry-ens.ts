/**
 * One-off debug: what does the org ENS say about the document registry?
 * Reads the `soulvault.documentRegistry` text record (chain-keyed JSON) and
 * the ENSIP-11 addr(rootNode, coinType(11155111)) slot. Safe to delete.
 */
import { createPublicClient, http, namehash, type Address } from "viem";
import { sepolia } from "viem/chains";
import { getEnsResolver, getEnsText } from "viem/ens";

const client = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com"),
});

const name = "soulvault-demo.eth";
const node = namehash(name);
const SEPOLIA_COIN_TYPE = 2158638759n; // 0x80000000 | 11155111

const resolver = await getEnsResolver(client, { name });
console.log("resolver:", resolver);

const text = await getEnsText(client, { name, key: "soulvault.documentRegistry" });
console.log("soulvault.documentRegistry text record:", text ?? "(unset)");

const ensip11 = (await client.readContract({
  address: resolver,
  abi: [
    {
      type: "function",
      name: "addr",
      stateMutability: "view",
      inputs: [
        { name: "node", type: "bytes32" },
        { name: "coinType", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bytes" }],
    },
  ] as const,
  functionName: "addr",
  args: [node, SEPOLIA_COIN_TYPE],
})) as Address;
console.log(`ENSIP-11 addr(rootNode, ${SEPOLIA_COIN_TYPE}):`, ensip11);
