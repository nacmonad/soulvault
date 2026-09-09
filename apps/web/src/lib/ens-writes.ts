/**
 * Browser-side ENS writes for the creation wizards (docs/dashboard-ui/009-create-flows.md).
 *
 * Ported from packages/node/src/ens.ts + swarm-deploy.ts. Byte-parity contract: the
 * CBOR `soulvault.swarms` list record must decode identically when the CLI reads it
 * (encodeStringArrayCbor / decodeStringArrayCbor round-trip).
 *
 * All writes go through the injected wallet (eth_sendTransaction) — no Node built-ins.
 */
import {
  encodeFunctionData,
  labelhash as viemLabelhash,
  namehash as viemNamehash,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";

import { getBrowserSoulVaultClientConfig, createSoulVaultPublicClient } from "@/lib/onchain/client";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

// Sepolia ENS contracts — same addresses the CLI uses (packages/node/src/ens.ts).
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Address;
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as Address;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ type: "address" }],
  },
] as const;

const RESOLVER_ABI = [
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
      { name: "a", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "addr",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
    ],
    outputs: [{ type: "bytes" }],
  },
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "a", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

/** ENSIP-11 EVM coinType derivation: `0x80000000 | chainId`. */
export function coinTypeForChain(chainId: number): number {
  return (0x80000000 | chainId) >>> 0;
}

export function namehash(name: string): Hex {
  return viemNamehash(name);
}

export function labelhash(label: string): Hex {
  return viemLabelhash(label);
}

function publicClient(): PublicClient {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) throw new Error("SoulVault dashboard config missing — set NEXT_PUBLIC_SOULVAULT_* env vars.");
  return createSoulVaultPublicClient(config);
}

async function requireOrgOwnership(input: { orgEnsName: string; from: Address }) {
  const client = publicClient();
  const orgNode = namehash(normalize(input.orgEnsName));
  const owner = (await client.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [orgNode],
  })) as Address;
  if (owner.toLowerCase() !== input.from.toLowerCase()) {
    throw new Error(
      `Wallet ${input.from} does not own ${input.orgEnsName} (owner ${owner}). ENS writes must come from the org owner.`,
    );
  }
}

// ---------------------------------------------------------------------------
// CBOR string[] encoder — byte-parity port of packages/node/src/ens.ts
// (major type 4 arrays of major type 3 text strings, RFC 8949 §3 length rules).
// ---------------------------------------------------------------------------

function encodeCborLength(majorType: number, n: number): Uint8Array {
  const head = (majorType & 0x07) << 5;
  if (n < 24) return new Uint8Array([head | n]);
  if (n < 0x100) return new Uint8Array([head | 24, n]);
  if (n < 0x10000) return new Uint8Array([head | 25, (n >> 8) & 0xff, n & 0xff]);
  return new Uint8Array([head | 26, (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

export function encodeStringArrayCbor(items: string[]): Uint8Array {
  const chunks: Uint8Array[] = [encodeCborLength(4, items.length)];
  const utf8 = new TextEncoder();
  for (const s of items) {
    const bytes = utf8.encode(s);
    chunks.push(encodeCborLength(3, bytes.length));
    chunks.push(bytes);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const CBOR_DATA_URI_PREFIX = "data:application/cbor;base64,";

// The CLI stores `soulvault.swarms` as a CBOR array wrapped in a data URI, sorted + deduped
// (writeOrgSwarmsList). Match it exactly so CLI readers decode browser-written lists.
export function encodeSwarmsListDataUri(labels: string[]): string {
  const sorted = [...new Set(labels)].sort();
  return CBOR_DATA_URI_PREFIX + bytesToBase64(encodeStringArrayCbor(sorted));
}

/** Read the org's member-swarms list (data:application/cbor;base64 CBOR string array). */
export async function readOrgSwarmsList(orgEnsName: string): Promise<string[]> {
  const client = publicClient();
  const node = namehash(normalize(orgEnsName));
  const raw = (await client.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, "soulvault.swarms"],
  })) as string;
  if (!raw || !raw.startsWith(CBOR_DATA_URI_PREFIX)) return [];
  try {
    const binary = atob(raw.slice(CBOR_DATA_URI_PREFIX.length));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return decodeStringArrayCbor(bytes);
  } catch {
    return [];
  }
}

function readCborLength(buf: Uint8Array, offset: number, expectedMajorType: number): { len: number; next: number } {
  if (offset >= buf.length) throw new Error("CBOR truncated: expected length byte");
  const head = buf[offset];
  const majorType = (head >> 5) & 0x07;
  if (majorType !== expectedMajorType) {
    throw new Error(`CBOR major type mismatch at offset ${offset}: expected ${expectedMajorType}, got ${majorType}`);
  }
  const ai = head & 0x1f;
  if (ai < 24) return { len: ai, next: offset + 1 };
  if (ai === 24) return { len: buf[offset + 1], next: offset + 2 };
  if (ai === 25) return { len: (buf[offset + 1] << 8) | buf[offset + 2], next: offset + 3 };
  if (ai === 26) {
    return {
      len: buf[offset + 1] * 0x1000000 + (buf[offset + 2] << 16) + (buf[offset + 3] << 8) + buf[offset + 4],
      next: offset + 5,
    };
  }
  throw new Error(`CBOR additional info ${ai} not supported by this minimal decoder`);
}

function decodeStringArrayCbor(buf: Uint8Array): string[] {
  const { len, next } = readCborLength(buf, 0, 4);
  const out: string[] = [];
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let cursor = next;
  for (let i = 0; i < len; i++) {
    const { len: strLen, next: afterHead } = readCborLength(buf, cursor, 3);
    if (afterHead + strLen > buf.length) throw new Error("CBOR truncated: string payload overruns buffer");
    out.push(utf8.decode(buf.subarray(afterHead, afterHead + strLen)));
    cursor = afterHead + strLen;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Write helpers — each is one wallet prompt + receipt wait
// ---------------------------------------------------------------------------

/** ENSIP-11: publish `address` under the org name at the Sepolia coinType. */
export async function setAddrMultichain(input: {
  from: Address;
  ensName: string;
  chainId: number;
  address: Address;
}): Promise<{ txHash: Hex; coinType: number }> {
  await requireOrgOwnership({ orgEnsName: input.ensName, from: input.from });
  const node = namehash(normalize(input.ensName));
  const coinType = coinTypeForChain(input.chainId);
  const txHash = await sendWalletTransaction({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      // 3-arg ENSIP-11 overload; args tuple disambiguates from the 2-arg setAddr.
      functionName: "setAddr",
      args: [node, BigInt(coinType), toHex(input.address)],
    }),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`setAddr reverted (tx ${txHash}).`);
  return { txHash, coinType };
}

/** ENSIP-11 read at the given chain's coinType. Returns null when unset. */
export async function getAddrMultichain(input: {
  ensName: string;
  chainId: number;
}): Promise<Address | null> {
  const client = publicClient();
  const node = namehash(normalize(input.ensName));
  const coinType = coinTypeForChain(input.chainId);
  const bytes = (await client.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "addr",
    args: [node, BigInt(coinType)],
  })) as Hex;
  if (!bytes || bytes === "0x" || bytes.length < 42) return null;
  return `0x${bytes.slice(-40)}` as Address;
}

/**
 * Bind a swarm subdomain: setSubnodeRecord + setAddr + the two text records,
 * byte-parity with the CLI's bindSwarmEnsSubdomain (packages/node/src/swarm-deploy.ts).
 */
export async function bindSwarmEnsSubdomain(input: {
  from: Address;
  organizationEnsName: string;
  swarmEnsName: string;
  contractAddress: Address;
  chainId: number;
}): Promise<{ subnodeTxHash: Hex; addrTxHash: Hex; chainIdTxHash: Hex; contractTxHash: Hex }> {
  await requireOrgOwnership({ orgEnsName: input.organizationEnsName, from: input.from });
  const orgNode = namehash(normalize(input.organizationEnsName));
  const swarmLabel = input.swarmEnsName.replace(`.${input.organizationEnsName}`, "");
  const swarmNode = namehash(normalize(input.swarmEnsName));

  const subnodeTxHash = await sendWalletTransaction({
    from: input.from,
    to: ENS_REGISTRY,
    data: encodeFunctionData({
      abi: REGISTRY_ABI,
      functionName: "setSubnodeRecord",
      args: [orgNode, labelhash(swarmLabel), input.from, PUBLIC_RESOLVER, 0n],
    }),
  });
  const subnodeReceipt = await waitForWalletReceipt(subnodeTxHash);
  if (subnodeReceipt.status !== "success") throw new Error(`setSubnodeRecord reverted (tx ${subnodeTxHash}).`);

  const setAddrTxHash = await sendWalletTransaction({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setAddr",
      args: [swarmNode, input.contractAddress],
    }),
  });
  const setAddrReceipt = await waitForWalletReceipt(setAddrTxHash);
  if (setAddrReceipt.status !== "success") throw new Error(`setAddr reverted (tx ${setAddrTxHash}).`);

  const chainIdTxHash = await sendWalletTransaction({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [swarmNode, "soulvault.chainId", String(input.chainId)],
    }),
  });
  const chainIdReceipt = await waitForWalletReceipt(chainIdTxHash);
  if (chainIdReceipt.status !== "success") throw new Error(`setText(soulvault.chainId) reverted (tx ${chainIdTxHash}).`);

  const contractTxHash = await sendWalletTransaction({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [swarmNode, "soulvault.swarmContract", input.contractAddress],
    }),
  });
  const contractReceipt = await waitForWalletReceipt(contractTxHash);
  if (contractReceipt.status !== "success") throw new Error(`setText(soulvault.swarmContract) reverted (tx ${contractTxHash}).`);

  return { subnodeTxHash, addrTxHash: setAddrTxHash, chainIdTxHash, contractTxHash };
}

/** Idempotent append of the swarm label to the org's CBOR `soulvault.swarms` record. */
export async function addSwarmToOrgList(input: {
  from: Address;
  organizationEnsName: string;
  label: string;
}): Promise<Hex | null> {
  await requireOrgOwnership({ orgEnsName: input.organizationEnsName, from: input.from });
  const list = await readOrgSwarmsList(input.organizationEnsName);
  if (list.includes(input.label)) return null;
  const value = encodeSwarmsListDataUri([...list, input.label]);
  const txHash = await sendWalletTransaction({
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [namehash(normalize(input.organizationEnsName)), "soulvault.swarms", value],
    }),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`setText(soulvault.swarms) reverted (tx ${txHash}).`);
  return txHash;
}
