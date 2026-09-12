// One-off onchain read: locate soulvault-ensv2.eth's ENSv2 registry (CREATE2
// recompute), read its resolver + state, then dump org text records from both
// the org PermissionedResolver and the v1 PublicResolver.
import {
  createPublicClient,
  http,
  namehash,
  labelhash,
  keccak256,
  encodeFunctionData,
  getCreate2Address,
  pad,
  concatHex,
  getAddress,
} from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com") });

const ORG = "soulvault-ensv2.eth";
const OWNER = getAddress("0x56C528C96D19bd88844fb608035f4c745f25287b");
const FACTORY = getAddress("0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef");
const PUBLIC_RESOLVER = getAddress("0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5");
const V1_REGISTRY = getAddress("0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e");

const VIEW = [{ type: "function", name: "proxyLogic", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] }] as const;
const proxyLogic = getAddress(
  (await client.readContract({ address: FACTORY, abi: VIEW, functionName: "proxyLogic" })) as `0x${string}`,
);

function outerSaltFor(deployer: `0x${string}`, salt: bigint) {
  const data = encodeFunctionData({
    abi: [{ type: "function", name: "__abiEncodeOnly", inputs: [{ type: "address" }, { type: "uint256" }, ], outputs: [] }],
    functionName: "__abiEncodeOnly",
    args: [deployer, salt],
  });
  return keccak256(("0x" + data.slice(10)) as `0x${string}`);
}

const outerSalt = outerSaltFor(OWNER, BigInt(labelhash("soulvault-ensv2")));
const initCode = concatHex([
  "0x3d604d80600a3d3981f3363d3d373d3d3d363d73" as `0x${string}`,
  pad(proxyLogic, { size: 20 }),
  "0x5af43d82803e903d91602b57fd5bf3" as `0x${string}`,
  pad(outerSalt, { size: 32 }),
]);
const registry = getCreate2Address({ from: FACTORY, salt: outerSalt, bytecodeHash: keccak256(initCode) });
console.log("predicted org registry:", registry);

const STATE_ABI = [
  { type: "function", name: "getState", stateMutability: "view", inputs: [{ name: "anyId", type: "uint256" }], outputs: [{ name: "state", type: "tuple", components: [{ name: "status", type: "uint8" }, { name: "expiry", type: "uint64" }, { name: "latestOwner", type: "address" }, { name: "tokenId", type: "uint256" }, { name: "resource", type: "uint256" }] }] },
  { type: "function", name: "getResolver", stateMutability: "view", inputs: [{ name: "label", type: "string" }], outputs: [{ type: "address" }] },
] as const;
const RESOLVER_ABI = [
  { type: "function", name: "text", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "key", type: "string" }], outputs: [{ type: "string" }] },
  { type: "function", name: "addr", stateMutability: "view", inputs: [{ name: "node", type: "bytes32" }, { name: "coinType", type: "uint256" }], outputs: [{ type: "bytes" }] },
] as const;

const stateRaw = await client.readContract({ address: registry, abi: STATE_ABI, functionName: "getState", args: [BigInt(labelhash("soulvault-ensv2"))] });
console.log("getState raw:", JSON.stringify(stateRaw, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

let resolverAddr: `0x${string}` | null = null;
try {
  resolverAddr = getAddress((await client.readContract({ address: registry, abi: STATE_ABI, functionName: "getResolver", args: ["soulvault-ensv2"] })) as `0x${string}`);
} catch {}
console.log("org PermissionedResolver:", resolverAddr);

const v1Owner = await client.readContract({ address: V1_REGISTRY, abi: [{ type: "function", name: "owner", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] }] as const, functionName: "owner", args: [namehash(ORG)] });
console.log("v1 registry owner:", v1Owner);

const node = namehash(ORG);
const CTYPE_SEPOLIA = BigInt(0x80000000 | 11155111);
const CTYPE_GALILEO = BigInt(0x80000000 | 16602);

async function dump(resolver: `0x${string}`, tag: string) {
  console.log(`--- ${tag} (${resolver}) ---`);
  for (const key of ["class", "name", "url", "soulvault.ensv2Registry", "soulvault.treasuries", "soulvault.swarms", "soulvault.documentRegistry"]) {
    try {
      const v = (await client.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "text", args: [node, key] })) as string;
      console.log(`  text ${key} = ${v ? JSON.stringify(v.length > 260 ? v.slice(0, 260) + "…" : v) : "(empty)"}`);
    } catch (e) {
      console.log(`  text ${key} = <revert: ${(e as Error).message.slice(0, 80)}>`);
    }
  }
  for (const [tag, ct] of [["sepolia", CTYPE_SEPOLIA], ["galileo", CTYPE_GALILEO], ["evm60", 60n]] as const) {
    try {
      const bytes = (await client.readContract({ address: resolver, abi: RESOLVER_ABI, functionName: "addr", args: [node, ct] })) as `0x${string}`;
      console.log(`  addr ${tag} (coinType ${ct}) = ${bytes && bytes.length >= 42 ? "0x" + bytes.slice(-40) : "(empty)"}`);
    } catch (e) {
      console.log(`  addr ${tag} = <revert: ${(e as Error).message.slice(0, 80)}>`);
    }
  }
}

if (resolverAddr && resolverAddr !== "0x0000000000000000000000000000000000000000") await dump(resolverAddr, "org resolver");
await dump(PUBLIC_RESOLVER, "v1 PUBLIC_RESOLVER");
