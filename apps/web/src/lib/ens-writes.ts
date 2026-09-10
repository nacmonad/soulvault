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
  getAddress,
  labelhash as viemLabelhash,
  namehash as viemNamehash,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { normalize } from "viem/ens";

import { getBrowserSoulVaultClientConfig, createSoulVaultPublicClient } from "@/lib/onchain/client";
import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

// Sepolia ENS contracts — same addresses the CLI uses (packages/node/src/ens.ts).
const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as Address;
const PUBLIC_RESOLVER = "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5" as Address;

/** Transient read failures worth retrying (public-RPC 429s, hiccups). */
const TRANSIENT_READ_PATTERN = /rate limit|429|too many|timeout|temporarily|network|fetch failed/i;

/**
 * Retry a read on transient errors. Several callers treat a failed ENS read as
 * "record not present" (`.catch(() => null)`), so one 429 during the mount-time
 * burst silently drops contracts from event discovery — retry before giving up.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= attempts - 1 || !TRANSIENT_READ_PATTERN.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
}

export const REGISTRY_ABI = [
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

export const RESOLVER_ABI = [
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

/** In-flight resolver-read coalescing. Several components fire the same ENS
 * reads at mount (page discovery + OrgEventSourcesBridge + registry source
 * resolution); under a public-RPC rate limit each duplicate call is another
 * 429 waiting to happen, and a failed read is silently treated as "record
 * missing" by callers. Identical concurrent reads share one request — and
 * one retry loop — instead of multiplying the burst. */
const inflightReads = new Map<string, Promise<unknown>>();

function coalesceRead<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflightReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = run();
  const settle = () => {
    if (inflightReads.get(key) === promise) inflightReads.delete(key);
  };
  promise.then(settle, settle);
  inflightReads.set(key, promise);
  return promise;
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
  const raw = (await coalesceRead(`text:${node}:${"soulvault.swarms"}`, () =>
    withTransientRetry(() =>
      client.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, "soulvault.swarms"],
      }),
    ),
  )) as string;
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      // 3-arg ENSIP-11 overload; args tuple disambiguates from the 2-arg setAddr.
      // The address must be raw 20-byte data — toHex(address) ASCII-encodes the
      // "0x…" string (42 bytes) and the resolver reverts on length.
      functionName: "setAddr",
      args: [node, BigInt(coinType), getAddress(input.address)],
    }),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`setAddr reverted (tx ${txHash}).`);
  return { txHash, coinType };
}

/** ENSIP-11 read at the given chain's coinType. Returns null when unset.
 * Pass `client` to read on a specific lane (defaults to the dashboard's
 * configured Sepolia client — the only ENS lane). */
export async function getAddrMultichain(input: {
  ensName: string;
  chainId: number;
  client?: PublicClient;
}): Promise<Address | null> {
  const client = input.client ?? publicClient();
  const node = namehash(normalize(input.ensName));
  const coinType = coinTypeForChain(input.chainId);
  const bytes = (await coalesceRead(`addr:${node}:${coinType}`, () =>
    withTransientRetry(() =>
      client.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "addr",
        args: [node, BigInt(coinType)],
      }),
    ),
  )) as Hex;
  if (!bytes || bytes === "0x" || bytes.length < 42) return null;
  return `0x${bytes.slice(-40)}` as Address;
}

/** Read a text record off any ENS name (Sepolia resolver). */
export async function readEnsText(ensName: string, key: string): Promise<string | null> {
  const client = publicClient();
  const node = namehash(normalize(ensName));
  const raw = (await coalesceRead(`text:${node}:${key}`, () =>
    withTransientRetry(() =>
      client.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, key],
      }),
    ),
  )) as string;
  return raw || null;
}

/** Read the EVM (coinType 60) addr of any ENS name — what the two-arg setAddr writes. */
export async function readEnsAddress(ensName: string): Promise<Address | null> {
  const client = publicClient();
  const node = namehash(normalize(ensName));
  const bytes = (await coalesceRead(`addr:${node}:60`, () =>
    withTransientRetry(() =>
      client.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "addr",
        args: [node, 60n],
      }),
    ),
  )) as Hex;
  if (!bytes || bytes === "0x" || bytes.length < 42) return null;
  return getAddress(`0x${bytes.slice(-40)}` as Address);
}

// ---------------------------------------------------------------------------
// Org treasury enumeration record (`soulvault.treasuries` text record)
// ---------------------------------------------------------------------------
//
// ENSIP-11 addr slots are not enumerable on-chain, so a consumer that only knows
// the org ENS name cannot discover which chains hold treasuries. This single known
// text record is the discovery index — JSON array, one entry per (org, chain).
// Byte-format parity with the CLI (packages/node/src/treasury-deploy.ts).

export const TREASURIES_TEXT_RECORD_KEY = "soulvault.treasuries";

export type OrgTreasuryEntry = {
  chainId: number;
  address: Address;
  label?: string;
  createdAt?: string;
};

/** Tolerant decode — garbage in, empty array out. Mirrors the CLI parser. */
export function parseTreasuriesRecord(raw: string): OrgTreasuryEntry[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is OrgTreasuryEntry =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as OrgTreasuryEntry).chainId === "number" &&
        typeof (entry as OrgTreasuryEntry).address === "string",
    );
  } catch {
    return [];
  }
}

/** Upsert by chainId, sorted ascending. Inherits prior label/createdAt when omitted. */
export function upsertTreasuryEntry(
  existing: OrgTreasuryEntry[],
  entry: OrgTreasuryEntry,
): OrgTreasuryEntry[] {
  const prior = existing.find((e) => e.chainId === entry.chainId);
  const merged: OrgTreasuryEntry = {
    chainId: entry.chainId,
    address: getAddress(entry.address),
    label: entry.label ?? prior?.label,
    createdAt: entry.createdAt ?? prior?.createdAt,
  };
  return [...existing.filter((e) => e.chainId !== entry.chainId), merged].sort(
    (a, b) => a.chainId - b.chainId,
  );
}

/** Read the org's treasury enumeration record. Empty array when unset/unparseable. */
export async function readOrgTreasuries(orgEnsName: string): Promise<OrgTreasuryEntry[]> {
  const client = publicClient();
  const node = namehash(normalize(orgEnsName));
  const raw = (await coalesceRead(`text:${node}:${TREASURIES_TEXT_RECORD_KEY}`, () =>
    withTransientRetry(() =>
      client.readContract({
        address: PUBLIC_RESOLVER,
        abi: RESOLVER_ABI,
        functionName: "text",
        args: [node, TREASURIES_TEXT_RECORD_KEY],
      }),
    ),
  )) as string;
  return parseTreasuriesRecord(raw ?? "");
}

/** Idempotent upsert of a treasury entry into the org's `soulvault.treasuries` record. */
export async function upsertOrgTreasury(input: {
  from: Address;
  organizationEnsName: string;
  entry: OrgTreasuryEntry;
}): Promise<Hex | null> {
  await requireOrgOwnership({ orgEnsName: input.organizationEnsName, from: input.from });
  const existing = await readOrgTreasuries(input.organizationEnsName);
  const next = upsertTreasuryEntry(existing, input.entry);
  const value = JSON.stringify(next, null, 0);
  if (value === JSON.stringify(existing, null, 0)) return null;
  const txHash = await sendWalletTransaction({
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [namehash(normalize(input.organizationEnsName)), TREASURIES_TEXT_RECORD_KEY, value],
    }),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`setText(${TREASURIES_TEXT_RECORD_KEY}) reverted (tx ${txHash}).`);
  return txHash;
}

// ---------------------------------------------------------------------------
// DocumentRegistry announce — protocol root name (ticket 012 §D v1)
// ---------------------------------------------------------------------------

export const DOCUMENT_REGISTRY_TEXT_RECORD_KEY = "soulvault.documentRegistry";

export type DocumentRegistryEnsRecord = {
  chainId: number;
  address: string;
  deployedAtBlock?: number;
  deployedAt?: string;
};

/** Tolerant decode of the `soulvault.documentRegistry` record — empty array when absent/garbage. Chain-keyed (mirroring `soulvault.treasuries`): one entry per chain, second-chain deploys never clobber the first. */
export function parseDocumentRegistryEntries(raw: string): DocumentRegistryEnsRecord[] {
  if (!raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is DocumentRegistryEnsRecord =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as DocumentRegistryEnsRecord).chainId === "number" &&
        typeof (entry as DocumentRegistryEnsRecord).address === "string",
    );
  } catch {
    return [];
  }
}

/** Upsert by chainId, sorted ascending. Inherits the existing entry's deployedAt/deployedAtBlock when omitted. */
export function upsertDocumentRegistryEntry(
  existing: DocumentRegistryEnsRecord[],
  entry: DocumentRegistryEnsRecord,
): DocumentRegistryEnsRecord[] {
  const prior = existing.find((e) => e.chainId === entry.chainId);
  const merged: DocumentRegistryEnsRecord = {
    chainId: entry.chainId,
    address: getAddress(entry.address),
    deployedAtBlock: entry.deployedAtBlock ?? prior?.deployedAtBlock,
    deployedAt: entry.deployedAt ?? prior?.deployedAt,
  };
  return [...existing.filter((e) => e.chainId !== entry.chainId), merged].sort(
    (a, b) => a.chainId - b.chainId,
  );
}

export async function readDocumentRegistryEntries(
  rootEnsName: string,
  client?: PublicClient,
): Promise<DocumentRegistryEnsRecord[]> {
  const readClient = client ?? publicClient();
  const node = namehash(normalize(rootEnsName));
  const raw = (await readClient.readContract({
    address: PUBLIC_RESOLVER,
    abi: RESOLVER_ABI,
    functionName: "text",
    args: [node, DOCUMENT_REGISTRY_TEXT_RECORD_KEY],
  })) as string;
  return parseDocumentRegistryEntries(raw ?? "");
}

/** Idempotent upsert of the registry entry into the root name's `soulvault.documentRegistry` record. */
export async function upsertDocumentRegistryEnsRecord(input: {
  from: Address;
  rootEnsName: string;
  entry: DocumentRegistryEnsRecord;
}): Promise<Hex | null> {
  await requireOrgOwnership({ orgEnsName: input.rootEnsName, from: input.from });
  const existing = await readDocumentRegistryEntries(input.rootEnsName);
  const next = upsertDocumentRegistryEntry(existing, input.entry);
  const value = JSON.stringify(next, null, 0);
  if (value === JSON.stringify(existing, null, 0)) return null;
  const txHash = await sendWalletTransaction({
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
    from: input.from,
    to: PUBLIC_RESOLVER,
    data: encodeFunctionData({
      abi: RESOLVER_ABI,
      functionName: "setText",
      args: [namehash(normalize(input.rootEnsName)), DOCUMENT_REGISTRY_TEXT_RECORD_KEY, value],
    }),
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success")
    throw new Error(`setText(${DOCUMENT_REGISTRY_TEXT_RECORD_KEY}) reverted (tx ${txHash}).`);
  return txHash;
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
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
    // ENS coordination is pinned to Sepolia — registry/resolver live there.
    chainId: SEPOLIA_CHAIN_ID,
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
