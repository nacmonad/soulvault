import { Contract, JsonRpcProvider, ZeroAddress, getAddress, getBytes, hexlify } from 'ethers';
import { namehash, normalize } from 'viem/ens';
import { loadEnv } from './config.js';
import { createSignerForProvider } from './signer.js';

const ENS_REGISTRY_ABI = [
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
  'function setResolver(bytes32 node, address resolver)',
] as const;

const PUBLIC_RESOLVER_ABI = [
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string key, string value)',
  'function setName(bytes32 node, string newName)',
] as const;

/** EIP-634 text records on the ENS resolver for a name. */
const EXTENDED_RESOLVER_TEXT_ABI = ['function text(bytes32 node, string key) view returns (string)'] as const;

// ETHRegistrarController ABI — the NameWrapper-aware flat 8-argument variant used by
// both ens-app-v3's local deployment and most mainstream ENS controller deployments.
// `rentPrice` returns a flat `uint256` (the base price in wei) rather than the
// `(base, premium)` tuple used by the newest Sepolia controller — the older flat form
// is what the ens-contracts repo actually publishes and what our local test harness
// uses, so we standardize on it. If you need the newer tuple-returning controller,
// add a separate `rentPrice(string,uint256)(uint256,uint256)` overload here and detect
// at runtime via a probe.
// ETHRegistrarController ABI — the NameWrapper-aware flat 8-argument variant used by
// both ens-app-v3's local deployment and most mainstream ENS controller deployments.
// `rentPrice` returns a flat `uint256` (the base price in wei) rather than the
// `(base, premium)` tuple used by the newest Sepolia controller — the older flat form
// is what the ens-contracts repo actually publishes and what our local test harness
// uses, so we standardize on it. If you need the newer tuple-returning controller,
// add a separate `rentPrice(string,uint256)(uint256,uint256)` overload here and detect
// at runtime via a probe.
const ETH_REGISTRAR_CONTROLLER_ABI = [
  'function available(string label) view returns (bool)',
  'function valid(string label) view returns (bool)',
  'function minCommitmentAge() view returns (uint256)',
  'function rentPrice(string label, uint256 duration) view returns (uint256)',
  'function makeCommitment(string label, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) pure returns (bytes32 commitment)',
  'function commit(bytes32 commitment)',
  'function register(string label, address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses) payable',
  'function nameWrapper() view returns (address)',
] as const;

// NameWrapper ABI — only the methods we need to unwrap a freshly-registered .eth 2LD.
// When a name is registered through a NameWrapper-aware controller, the ENS registry's
// `owner(node)` is set to the NameWrapper contract, which breaks legacy registry calls
// like `setSubnodeRecord` that check `owner(node) == msg.sender`. For SoulVault's
// subdomain-heavy workflow we unwrap after registration so all downstream registry and
// resolver ops work directly.
const NAME_WRAPPER_ABI = [
  'function unwrapETH2LD(bytes32 labelhash, address registrant, address controller)',
] as const;

export function getNameWrapperContract(address: string, withSigner: boolean) {
  return (async () => {
    const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
    return new Contract(address, NAME_WRAPPER_ABI, runner);
  })();
}

export async function createEthProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_ETH_RPC_URL, env.SOULVAULT_ENS_CHAIN_ID);
}

export async function createEnsProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_ENS_RPC_URL, env.SOULVAULT_ENS_CHAIN_ID);
}

export async function createEnsSigner() {
  const provider = await createEnsProvider();
  return createSignerForProvider(provider);
}

export function getEnsContracts() {
  const env = loadEnv();
  return {
    registry: env.SOULVAULT_ENS_REGISTRY_ADDRESS,
    baseRegistrar: env.SOULVAULT_ENS_BASE_REGISTRAR_ADDRESS,
    controller: env.SOULVAULT_ENS_CONTROLLER_ADDRESS,
    publicResolver: env.SOULVAULT_ENS_PUBLIC_RESOLVER_ADDRESS,
    universalResolver: env.SOULVAULT_ENS_UNIVERSAL_RESOLVER_ADDRESS,
  };
}

export async function getEnsRegistry(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(getEnsContracts().registry, ENS_REGISTRY_ABI, runner);
}

export async function getPublicResolver(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(getEnsContracts().publicResolver, PUBLIC_RESOLVER_ABI, runner);
}

export async function getEthRegistrarController(withSigner = false) {
  const env = loadEnv();
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(env.SOULVAULT_ENS_CONTROLLER_ADDRESS, ETH_REGISTRAR_CONTROLLER_ABI, runner);
}

export function getSoulVaultEnsTextRecordKeys() {
  return [
    'soulvault.swarmContract',
    'soulvault.chainId',
    'soulvault.treasuryContract',
    'soulvault.treasuryChainId',
    'soulvault.publicManifestUri',
    'soulvault.publicManifestHash',
    'erc8004.registry',
    'erc8004.agentId',
  ] as const;
}

/** Normalized ENS full name, e.g. `foo.eth`. */
export function normalizeEnsName(name: string) {
  return normalize(name);
}

export async function readEnsNodeOwner(name: string) {
  const fullName = normalizeEnsName(name);
  const node = namehash(fullName);
  const registry = await getEnsRegistry(false);
  const owner = await registry.owner(node);
  return { fullName, node, owner: String(owner) };
}

/** Read a single text record via the name's current resolver. */
export async function readEnsText(ensName: string, key: string) {
  const { node } = await readEnsNodeOwner(ensName);
  const registry = await getEnsRegistry(false);
  const resolverAddress = await registry.resolver(node);
  const resolverStr = String(resolverAddress);
  if (!resolverAddress || resolverStr.toLowerCase() === ZeroAddress.toLowerCase()) {
    return '';
  }
  const provider = await createEnsProvider();
  const resolver = new Contract(resolverAddress, EXTENDED_RESOLVER_TEXT_ABI, provider);
  const value = await resolver.text(node, key);
  return String(value ?? '');
}

/**
 * Generic helper for writing a single text record on an ENS name. Resolves the node and
 * uses the public resolver (same one `bindTreasuryEnsTextRecords` / `bindSwarmEnsSubdomain`
 * use directly today). Returns the transaction receipt for idempotency tracking.
 */
export async function setEnsText(ensName: string, key: string, value: string) {
  const fullName = normalizeEnsName(ensName);
  const node = namehash(fullName);
  const resolver = await getPublicResolver(true);
  const tx = await resolver.setText(node, key, value);
  const receipt = await tx.wait();
  return { node, key, value, txHash: receipt?.hash as string | undefined };
}

// ---------------------------------------------------------------------------
// ENSIP-11 multichain address resolution
// ---------------------------------------------------------------------------
//
// The legacy PublicResolver ABI above only declares the 1-arg `setAddr(bytes32,address)`
// overload, which pins the value to coinType 60 (ETH mainnet). SoulVault needs to publish
// treasury/swarm addresses on non-mainnet EVM chains (0G Galileo = 16602, Base, etc.),
// which requires the 3-arg ENSIP-11 overload `setAddr(bytes32,uint256,bytes)`.
//
// We keep a separate Contract instance for the multicoin ABI to avoid ethers v6's
// overload-disambiguation pain — calling `resolver.setAddr(...)` would otherwise need an
// explicit signature-keyed access like `resolver['setAddr(bytes32,uint256,bytes)']`.

const PUBLIC_RESOLVER_MULTICOIN_ABI = [
  'function setAddr(bytes32 node, uint256 coinType, bytes a)',
  'function addr(bytes32 node, uint256 coinType) view returns (bytes)',
] as const;

/** ENSIP-11 EVM coinType derivation: `0x80000000 | chainId`. */
export function coinTypeForChain(chainId: number): number {
  // Use unsigned right shift to keep the result positive in JS number space.
  return (0x80000000 | chainId) >>> 0;
}

async function getMulticoinResolver(withSigner: boolean) {
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(getEnsContracts().publicResolver, PUBLIC_RESOLVER_MULTICOIN_ABI, runner);
}

/**
 * Write an EVM address under the ENSIP-11 coinType for the given chain. Reverts if the
 * caller's signer doesn't own (or isn't the resolver authorizer for) the ENS node.
 */
export async function setAddrMultichain(ensName: string, chainId: number, address: string) {
  const fullName = normalizeEnsName(ensName);
  const node = namehash(fullName);
  const coinType = coinTypeForChain(chainId);
  const addrBytes = getBytes(getAddress(address)); // 20-byte checksum-verified EVM address
  const resolver = await getMulticoinResolver(true);
  const tx = await resolver.setAddr(node, coinType, addrBytes);
  const receipt = await tx.wait();
  return { node, coinType, address: getAddress(address), txHash: receipt?.hash as string | undefined };
}

/**
 * Read the EVM address published under the ENSIP-11 coinType for the given chain.
 * Returns `null` if no record is set (resolver returns empty bytes).
 */
export async function getAddrMultichain(ensName: string, chainId: number): Promise<string | null> {
  const fullName = normalizeEnsName(ensName);
  const node = namehash(fullName);
  const coinType = coinTypeForChain(chainId);
  const resolver = await getMulticoinResolver(false);
  const bytes: string = await resolver.addr(node, coinType);
  if (!bytes || bytes === '0x' || bytes.length < 42) return null;
  // Cast the raw bytes back to a checksum address. The multicoin bytes for EVM chains
  // are the 20-byte address verbatim.
  return getAddress(hexlify(bytes));
}

// ---------------------------------------------------------------------------
// Hand-rolled CBOR encoder/decoder for string[] (RFC 8949)
// ---------------------------------------------------------------------------
//
// Scope is deliberately narrow: CBOR major type 4 (arrays) containing items of major
// type 3 (text strings). That's enough for the `soulvault.swarms` list record. Any
// richer metadata (nested maps, numbers, etc.) should pull in `cbor-x` instead of
// extending this.
//
// Length encoding per RFC 8949 §3:
//   additional info 0..23  → length inline in the head byte's low 5 bits
//   additional info 24     → 1 following byte of length
//   additional info 25     → 2 following bytes
//   additional info 26     → 4 following bytes
//   additional info 27     → 8 following bytes (we never hit this in practice)

function encodeCborLength(majorType: number, n: number): Uint8Array {
  const head = (majorType & 0x07) << 5;
  if (n < 24) return new Uint8Array([head | n]);
  if (n < 0x100) return new Uint8Array([head | 24, n]);
  if (n < 0x10000) return new Uint8Array([head | 25, (n >> 8) & 0xff, n & 0xff]);
  if (n < 0x100000000) {
    return new Uint8Array([
      head | 26,
      (n >>> 24) & 0xff,
      (n >>> 16) & 0xff,
      (n >>> 8) & 0xff,
      n & 0xff,
    ]);
  }
  throw new Error(`CBOR length ${n} exceeds 4-byte encoding (8-byte path not implemented)`);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
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

export function encodeStringArrayCbor(items: string[]): Uint8Array {
  const chunks: Uint8Array[] = [encodeCborLength(4, items.length)];
  const utf8 = new TextEncoder();
  for (const s of items) {
    const bytes = utf8.encode(s);
    chunks.push(encodeCborLength(3, bytes.length));
    chunks.push(bytes);
  }
  return concatBytes(chunks);
}

function readCborLength(buf: Uint8Array, offset: number, expectedMajorType: number): { len: number; next: number } {
  if (offset >= buf.length) throw new Error('CBOR truncated: expected length byte');
  const head = buf[offset];
  const majorType = (head >> 5) & 0x07;
  if (majorType !== expectedMajorType) {
    throw new Error(`CBOR major type mismatch at offset ${offset}: expected ${expectedMajorType}, got ${majorType}`);
  }
  const ai = head & 0x1f;
  if (ai < 24) return { len: ai, next: offset + 1 };
  if (ai === 24) {
    if (offset + 1 >= buf.length) throw new Error('CBOR truncated: expected 1-byte length');
    return { len: buf[offset + 1], next: offset + 2 };
  }
  if (ai === 25) {
    if (offset + 2 >= buf.length) throw new Error('CBOR truncated: expected 2-byte length');
    return { len: (buf[offset + 1] << 8) | buf[offset + 2], next: offset + 3 };
  }
  if (ai === 26) {
    if (offset + 4 >= buf.length) throw new Error('CBOR truncated: expected 4-byte length');
    const len =
      buf[offset + 1] * 0x1000000 +
      (buf[offset + 2] << 16) +
      (buf[offset + 3] << 8) +
      buf[offset + 4];
    return { len, next: offset + 5 };
  }
  throw new Error(`CBOR additional info ${ai} not supported by this minimal decoder`);
}

export function decodeStringArrayCbor(buf: Uint8Array): string[] {
  const { len, next } = readCborLength(buf, 0, 4);
  const out: string[] = [];
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let cursor = next;
  for (let i = 0; i < len; i++) {
    const { len: strLen, next: afterHead } = readCborLength(buf, cursor, 3);
    if (afterHead + strLen > buf.length) throw new Error('CBOR truncated: string payload overruns buffer');
    out.push(utf8.decode(buf.subarray(afterHead, afterHead + strLen)));
    cursor = afterHead + strLen;
  }
  return out;
}

// Base64 helpers using Node's Buffer (the CLI already runs on Node; no browser shim needed).
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

const CBOR_DATA_URI_PREFIX = 'data:application/cbor;base64,';

/** Wrap raw CBOR bytes as a `data:application/cbor;base64,…` URI safe for `setText`. */
export function encodeCborDataUri(bytes: Uint8Array): string {
  return CBOR_DATA_URI_PREFIX + toBase64(bytes);
}

/**
 * Parse a `data:application/cbor;base64,…` URI back to raw CBOR bytes.
 * Returns `null` on missing / malformed input so callers can treat it as "no record".
 */
export function decodeCborDataUri(value: string): Uint8Array | null {
  if (!value || !value.startsWith(CBOR_DATA_URI_PREFIX)) return null;
  try {
    return fromBase64(value.slice(CBOR_DATA_URI_PREFIX.length));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Organization metadata ENS record helpers (draft ENSIP-aligned)
// ---------------------------------------------------------------------------
//
// Following the spirit of the in-flight ENSIP on organizational metadata: use
// ENS-conventional unprefixed keys where they exist (`name`, `description`, `url`,
// `avatar`) and namespace SoulVault-specific records (`soulvault.swarms`). The
// `class` key's value is namespaced (`soulvault.organization`) to avoid squatting
// on whatever vocabulary the ENSIP eventually canonicalizes.

export const OrgEnsRecordKeys = {
  class: 'class',
  name: 'name',
  description: 'description',
  url: 'url',
  swarms: 'soulvault.swarms',
} as const;

export const ORG_ENS_CLASS_VALUE = 'soulvault.organization';

export type OrgMetadataInput = {
  name?: string;
  description?: string;
  url?: string;
};

export type OrgMetadataWriteResult = {
  txHashes: {
    class?: string;
    name?: string;
    description?: string;
    url?: string;
  };
};

/**
 * Write the base organization metadata records on an ENS name. Idempotent — callers can
 * re-run without side effects beyond re-sending the same values. Skips fields that are
 * `undefined`. Always sets the `class` record as a signal that this name is a SoulVault
 * organization anchor.
 */
export async function writeOrgMetadata(
  ensName: string,
  input: OrgMetadataInput,
): Promise<OrgMetadataWriteResult> {
  const result: OrgMetadataWriteResult = { txHashes: {} };

  const classTx = await setEnsText(ensName, OrgEnsRecordKeys.class, ORG_ENS_CLASS_VALUE);
  result.txHashes.class = classTx.txHash;

  if (input.name !== undefined) {
    const tx = await setEnsText(ensName, OrgEnsRecordKeys.name, input.name);
    result.txHashes.name = tx.txHash;
  }
  if (input.description !== undefined) {
    const tx = await setEnsText(ensName, OrgEnsRecordKeys.description, input.description);
    result.txHashes.description = tx.txHash;
  }
  if (input.url !== undefined) {
    const tx = await setEnsText(ensName, OrgEnsRecordKeys.url, input.url);
    result.txHashes.url = tx.txHash;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Member-swarms list on the org ENS name
// ---------------------------------------------------------------------------
//
// Stored as a CBOR array of text strings wrapped in `data:application/cbor;base64,…`.
// The wrapping is critical: `setText`'s second argument is solidity `string`, and raw
// CBOR byte sequences are almost never valid UTF-8 — persisting them directly risks
// silent corruption on any reader that round-trips through UTF-8 decoding.
//
// Known limitation: read-modify-write is not atomic against concurrent writers. Two
// CLIs mutating the same org ENS name simultaneously may lose one of their mutations.
// This is acceptable for the current single-operator model; revisit with a reader/
// writer reconciliation pass if multi-operator workflows appear.

/** Read the list of member swarm labels from the org's ENS `soulvault.swarms` record. */
export async function readOrgSwarmsList(orgEnsName: string): Promise<string[]> {
  const raw = await readEnsText(orgEnsName, OrgEnsRecordKeys.swarms);
  if (!raw) return [];
  const bytes = decodeCborDataUri(raw);
  if (!bytes) {
    // Tolerate manual edits / legacy values — return empty instead of blowing up.
    return [];
  }
  try {
    return decodeStringArrayCbor(bytes);
  } catch {
    return [];
  }
}

/** Overwrite the org's member-swarms list. Dedupes and sorts for deterministic storage. */
export async function writeOrgSwarmsList(orgEnsName: string, labels: string[]) {
  const sorted = [...new Set(labels)].sort();
  const cbor = encodeStringArrayCbor(sorted);
  const value = encodeCborDataUri(cbor);
  return setEnsText(orgEnsName, OrgEnsRecordKeys.swarms, value);
}

/** Idempotent add — no-op if the label is already present. Returns the tx result or `null`. */
export async function addSwarmToOrgList(orgEnsName: string, label: string) {
  const list = await readOrgSwarmsList(orgEnsName);
  if (list.includes(label)) return null;
  return writeOrgSwarmsList(orgEnsName, [...list, label]);
}

/** Idempotent remove — no-op if the label is not present. Returns the tx result or `null`. */
export async function removeSwarmFromOrgList(orgEnsName: string, label: string) {
  const list = await readOrgSwarmsList(orgEnsName);
  if (!list.includes(label)) return null;
  return writeOrgSwarmsList(
    orgEnsName,
    list.filter((l) => l !== label),
  );
}
