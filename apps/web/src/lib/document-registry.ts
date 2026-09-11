import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import type { SecpWrappedKey } from "@soulvault/protocol";

import { SEPOLIA_CHAIN_ID, publicClientForChainId } from "@/lib/chains";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { contractScanStartBlock } from "@/lib/onchain/scan-start";
import { loadSelectedOrgEnsName } from "@/lib/dashboard-context";
import { getAddrMultichain, readDocumentRegistryEntries } from "@/lib/ens-writes";
import type { SoulVaultDeployment } from "@/lib/onchain/types";
import type { ChainSender } from "@/lib/wallet-tx";

export const WRITE_ABI = [
  {
    type: "function",
    name: "publishDocument",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "slotIds", type: "string[]" },
      { name: "selfieRequired", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "publishDocument",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "slotIds", type: "string[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "grantSlotKey",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "slotId", type: "string" },
      { name: "recipient", type: "address" },
      { name: "wrappedKey", type: "string" },
      { name: "algorithm", type: "string" },
      { name: "ephemeralPublicKey", type: "string" },
      { name: "nonce", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "grantSlotKeys",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "recipient", type: "address" },
      { name: "slotIds", type: "string[]" },
      { name: "wrappedKeys", type: "string[]" },
      { name: "algorithm", type: "string" },
      { name: "ephemeralPublicKeys", type: "string[]" },
      { name: "nonces", type: "string[]" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestRehydration",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "rehydrationPublicKey", type: "string" },
      { name: "selfieProof", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "requestRehydration",
    stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" },
      { name: "rehydrationPublicKey", type: "string" },
    ],
    outputs: [],
  },
] as const;

/**
 * DocumentRegistry discovery (ticket 012 §D).
 *
 * The registry is a global per-chain singleton, discovered via ENSIP-11 on the
 * protocol root name: `addr(rootName, coinType(chainId))`. Preference:
 * localStorage override → ENS → bundle hint (the hint is consumed by the
 * pages, not here — it is non-authoritative).
 */
const REGISTRY_OVERRIDE_KEY = "soulvault.documentRegistryOverride";
const ENS_ROOT_NAME_DEFAULT = "soulvault.eth";

/**
 * Root ENS name the registry is announced on. The registry is protocol-level,
 * but in practice the "protocol root" is the operator's own .eth name, so the
 * dashboard's selected organization wins when set (e.g. `soulvault-demo.eth`),
 * then the build-time env, then the canonical default. Must match the name the
 * deploy wizard announced on — both sides use this same resolution.
 */
export function resolveRootEnsName(): string {
  const org = loadSelectedOrgEnsName();
  if (org) return org;
  return process.env.NEXT_PUBLIC_SOULVAULT_ENS_ROOT_NAME || ENS_ROOT_NAME_DEFAULT;
}

function isValidRegistryAddress(candidate: string): candidate is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(candidate);
}

/** Operator override (localStorage). Returns null when unset or malformed. */
export function getDocumentRegistryOverride(): Address | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(REGISTRY_OVERRIDE_KEY);
    if (!raw || !isValidRegistryAddress(raw)) return null;
    return raw;
  } catch {
    return null;
  }
}

/** Returns null when the candidate is not a well-formed address. */
export function setDocumentRegistryOverride(candidate: string): Address | null {
  const normalized = candidate.trim();
  if (!isValidRegistryAddress(normalized)) return null;
  window.localStorage.setItem(REGISTRY_OVERRIDE_KEY, normalized);
  return normalized;
}

export function clearDocumentRegistryOverride(): void {
  window.localStorage.removeItem(REGISTRY_OVERRIDE_KEY);
}

export function documentRegistryAddress(): Address | null {
  return getDocumentRegistryOverride();
}

export type DocumentRegistrySource = "override" | "ens" | "bundle" | null;

/**
 * Full resolution chain: override → ENS (`addr(root, coinType(chainId))` on the
 * Sepolia resolver) → bundle hint. ENS failures (unregistered name, missing
 * record, unreachable RPC) fall through silently.
 */
export async function resolveDocumentRegistryAddress(input?: {
  chainId?: number;
  bundleHint?: { chainId: number; address: string } | null;
}): Promise<{ address: Address | null; source: DocumentRegistrySource }> {
  const override = getDocumentRegistryOverride();
  if (override) return { address: override, source: "override" };

  const config = getBrowserSoulVaultClientConfig();
  const chainId = input?.chainId ?? config?.chainId ?? SEPOLIA_CHAIN_ID;
  if (chainId) {
    try {
      // The ENS record lives on the identity lane (Sepolia) regardless of which
      // chain the registry deploys to. publicClientForChainId falls back to the
      // public Sepolia RPC, so discovery works with no env config at all.
      const client = publicClientForChainId(SEPOLIA_CHAIN_ID);
      const ens = client
        ? await getAddrMultichain({ ensName: resolveRootEnsName(), chainId, client })
        : null;
      if (ens) return { address: ens, source: "ens" };
    } catch {
      // fall through to the bundle hint
    }
  }

  const hint = input?.bundleHint;
  if (hint && isValidRegistryAddress(hint.address)) {
    return { address: hint.address, source: "bundle" };
  }
  return { address: null, source: null };
}

export function asDocHash(documentId: string): Hex {
  const hex = documentId.startsWith("0x") ? documentId : `0x${documentId}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("documentId is not a 32-byte hash");
  }
  return hex as Hex;
}

export async function publishDocument(input: {
  from: Address;
  documentId: string;
  slotIds: string[];
  selfieRequired?: boolean;
  send: ChainSender;
}): Promise<Hex> {
  const to = (await resolveDocumentRegistryAddress()).address;
  if (!to) throw new Error("No document registry discovered on ENS. Deploy one from the Documents page first.");
  const selfieRequired = Boolean(input.selfieRequired);
  const flagged = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "publishDocument",
    args: [asDocHash(input.documentId), input.slotIds, selfieRequired],
  });
  const data = await encodeWithLegacyFallback({
    to,
    from: input.from,
    preferred: flagged,
    legacy:
      selfieRequired
        ? null
        : encodeFunctionData({
            abi: WRITE_ABI,
            functionName: "publishDocument",
            args: [asDocHash(input.documentId), input.slotIds],
          }),
    missing:
      "This DocumentRegistry has no selfieRequired on publish. Redeploy the registry to set the World Selfie Check flag.",
  });
  return input.send({ from: input.from, to, data });
}

export async function grantSlotKey(input: {
  from: Address;
  documentId: string;
  slotId: string;
  recipient: Address;
  wrap: SecpWrappedKey;
  send: ChainSender;
}): Promise<Hex> {
  const to = (await resolveDocumentRegistryAddress()).address;
  if (!to) throw new Error("No document registry discovered on ENS. Deploy one from the Documents page first.");
  const data = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "grantSlotKey",
    args: [
      asDocHash(input.documentId),
      input.slotId,
      input.recipient,
      input.wrap.wrappedKey,
      input.wrap.algorithm,
      input.wrap.ephemeralPublicKey,
      input.wrap.nonce,
    ],
  });
  return input.send({ from: input.from, to, data });
}

export type GrantSlotsResult = {
  /** true when a single batch tx was sent; false when it fell back per-slot */
  batched: boolean;
  hashes: Hex[];
};

/**
 * Grant every slot in one tx via `grantSlotKeys` when the deployed registry
 * supports it (detected by simulating the call — no signature needed for the
 * probe), falling back to one `grantSlotKey` tx per slot for registries
 * deployed before the batch function existed. Event format is identical in
 * both paths, so consumers cannot tell the difference.
 */
export async function grantSlots(input: {
  from: Address;
  documentId: string;
  grants: { slotId: string; wrap: SecpWrappedKey; recipient: Address }[];
  send: ChainSender;
}): Promise<GrantSlotsResult> {
  const to = (await resolveDocumentRegistryAddress()).address;
  if (!to) throw new Error("No document registry discovered on ENS. Deploy one from the Documents page first.");
  if (input.grants.length === 0) throw new Error("No slots selected to grant.");

  const docHash = asDocHash(input.documentId);
  const batchData = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "grantSlotKeys",
    args: [
      docHash,
      input.grants[0].recipient,
      input.grants.map((grant) => grant.slotId),
      input.grants.map((grant) => grant.wrap.wrappedKey),
      input.grants[0].wrap.algorithm,
      input.grants.map((grant) => grant.wrap.ephemeralPublicKey),
      input.grants.map((grant) => grant.wrap.nonce),
    ],
  });

  const client = publicClientForChainId(getBrowserSoulVaultClientConfig()?.chainId ?? SEPOLIA_CHAIN_ID);
  let supportsBatch = false;
  if (client) {
    try {
      await client.call({ to, data: batchData, account: input.from });
      supportsBatch = true;
    } catch {
      // Old registry (unknown selector) or a real auth failure — the per-slot
      // path below will surface the accurate error either way.
    }
  }

  if (supportsBatch) {
    const hash = await input.send({ from: input.from, to, data: batchData });
    return { batched: true, hashes: [hash] };
  }

  const hashes: Hex[] = [];
  for (const grant of input.grants) {
    hashes.push(
      await grantSlotKey({
        from: input.from,
        documentId: input.documentId,
        slotId: grant.slotId,
        recipient: grant.recipient,
        wrap: grant.wrap,
        send: input.send,
      }),
    );
  }
  return { batched: false, hashes };
}

/**
 * Post the consumer's hydration request: `requestRehydration(docHash, pubkey)`
 * emits `RehydrationRequested`, whose msg.sender is tx-authenticated — the
 * author's client wraps slot keys to the event's rehydration public key.
 */
export async function requestRehydration(input: {
  from: Address;
  documentId: string;
  rehydrationPublicKey: string;
  selfieProof?: string;
  send: ChainSender;
}): Promise<Hex> {
  const to = (await resolveDocumentRegistryAddress()).address;
  if (!to) throw new Error("No document registry discovered on ENS. Deploy one from the Documents page first.");
  const proof = input.selfieProof ?? "";
  const flagged = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "requestRehydration",
    args: [asDocHash(input.documentId), input.rehydrationPublicKey, proof],
  });
  const data = await encodeWithLegacyFallback({
    to,
    from: input.from,
    preferred: flagged,
    legacy:
      proof.length > 0
        ? null
        : encodeFunctionData({
            abi: WRITE_ABI,
            functionName: "requestRehydration",
            args: [asDocHash(input.documentId), input.rehydrationPublicKey],
          }),
    missing:
      "This DocumentRegistry has no selfieProof on request. Redeploy the registry to carry a World Selfie Check proof.",
  });
  return input.send({ from: input.from, to, data });
}

async function encodeWithLegacyFallback(input: {
  to: Address;
  from: Address;
  preferred: Hex;
  legacy: Hex | null;
  missing: string;
}): Promise<Hex> {
  const client = publicClientForChainId(getBrowserSoulVaultClientConfig()?.chainId ?? SEPOLIA_CHAIN_ID);
  if (!client) return input.preferred;
  try {
    await client.call({ to: input.to, data: input.preferred, account: input.from });
    return input.preferred;
  } catch {
    if (!input.legacy) throw new Error(input.missing);
    return input.legacy;
  }
}

// ---------------------------------------------------------------------------
// Event-source discovery for the shared events provider
// ---------------------------------------------------------------------------

function clientForChain(chainId: number): PublicClient {
  return publicClientForChainId(chainId) as PublicClient;
}

/**
 * Scan-start block for the document registry's event log: the ENS text
 * record's `deployedAtBlock` when announced, else the shared hint → code
 * search → fallback-window resolution (cached per address in scan-start).
 */
export async function documentRegistryScanStartBlock(input: {
  address: Address;
  chainId: number;
  rootEnsName: string;
}): Promise<bigint> {
  let deployedAtBlock: number | null = null;
  try {
    const entries = await readDocumentRegistryEntries(input.rootEnsName, clientForChain(input.chainId));
    deployedAtBlock = entries.find((e) => e.chainId === input.chainId)?.deployedAtBlock ?? null;
  } catch {
    // fall through to the binary search
  }
  return contractScanStartBlock({
    address: input.address,
    chainId: input.chainId,
    deployedAtBlock,
  });
}

/**
 * The DocumentRegistry as a watcher event source, discovered at runtime —
 * the registry is a per-chain singleton announced on ENS, so it cannot be a
 * build-time env entry like the static deployments list. The events provider
 * merges this into its scan sources so Overview/Organization panels and the
 * events page see DocumentPublished/SlotKeyGranted.
 */
export async function resolveDocumentEventSource(input?: {
  chainId?: number;
}): Promise<SoulVaultDeployment | null> {
  const config = getBrowserSoulVaultClientConfig();
  const chainId = input?.chainId ?? config?.chainId ?? SEPOLIA_CHAIN_ID;
  const { address } = await resolveDocumentRegistryAddress({ chainId });
  if (!address) return null;
  const fromBlock = await documentRegistryScanStartBlock({
    address,
    chainId,
    rootEnsName: resolveRootEnsName(),
  });
  return { address, kind: "document", fromBlock, label: "document-registry" };
}
