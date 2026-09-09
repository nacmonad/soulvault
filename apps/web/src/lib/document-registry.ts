import { encodeFunctionData, type Address, type Hex } from "viem";
import type { SecpWrappedKey } from "@soulvault/protocol";

import { SEPOLIA_CHAIN_ID, publicClientForChainId } from "@/lib/chains";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { getAddrMultichain } from "@/lib/ens-writes";
import type { ChainSender } from "@/lib/wallet-tx";

export const WRITE_ABI = [
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
] as const;

/**
 * DocumentRegistry discovery (ticket 012 §D).
 *
 * The registry is a global per-chain singleton, discovered via ENSIP-11 on the
 * protocol root name: `addr(soulvault.eth, coinType(chainId))`. Preference:
 * localStorage override → ENS → env deployments → bundle hint (the hint is
 * consumed by the pages, not here — it is non-authoritative).
 */
const REGISTRY_OVERRIDE_KEY = "soulvault.documentRegistryOverride";
const ENS_ROOT_NAME_DEFAULT = "soulvault.eth";

function ensRootName(): string {
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

/** Sync fast path: override → env deployments. Render-safe; misses ENS. */
export function documentRegistryAddress(): Address | null {
  const override = getDocumentRegistryOverride();
  if (override) return override;
  const config = getBrowserSoulVaultClientConfig();
  return config?.deployments.find((item) => item.kind === "document")?.address ?? null;
}

export type DocumentRegistrySource = "override" | "ens" | "env" | "bundle" | null;

/**
 * Full resolution chain: override → ENS (`addr(root, coinType(chainId))` on the
 * Sepolia resolver) → env deployments → bundle hint. ENS failures (unregistered
 * name, missing record, unreachable RPC) fall through silently.
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
        ? await getAddrMultichain({ ensName: ensRootName(), chainId, client })
        : null;
      if (ens) return { address: ens, source: "ens" };
    } catch {
      // fall through to env / bundle hint
    }
  }

  const env = config?.deployments.find((item) => item.kind === "document")?.address ?? null;
  if (env) return { address: env, source: "env" };

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
  send: ChainSender;
}): Promise<Hex> {
  const to = (await resolveDocumentRegistryAddress()).address;
  if (!to) throw new Error("No document registry discovered (ENS / NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS).");
  const data = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "publishDocument",
    args: [asDocHash(input.documentId), input.slotIds],
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
  if (!to) throw new Error("No document registry discovered (ENS / NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS).");
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
