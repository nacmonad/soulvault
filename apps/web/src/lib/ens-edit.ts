// Editable ENS text records for an organization's profile — targets both
// protocols:
//   - ENSv2: writes go directly to the org's PermissionedResolver (the v1
//     registry cannot discover it — same bypass the read path uses).
//   - ENSv1: writes go to the resolver resolved via the v1 registry.
// Saving is idempotent: only records whose value actually differs are sent.
"use client";

import {
  encodeFunctionData,
  namehash,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { normalize } from "viem/ens";

import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
} from "@/lib/onchain/client";
import {
  decodeEnsV2RegistryRecord,
  encodeEnsV2RegistryRecord,
  ENSV2_REGISTRY_TEXT_KEY,
  resolveEnsV2OrgRecord,
} from "@/lib/ens-register-v2";
import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";

export const ORG_TEXT_KEYS = ["name", "org", "url", "description", "avatar"] as const;
export type OrgTextKey = (typeof ORG_TEXT_KEYS)[number];

/** Avatar data-URI ceiling — setText gas scales with value length. */
export const MAX_AVATAR_DATA_URI_BYTES = 100 * 1024;

export type EnsEditTarget = {
  resolver: Address;
  node: `0x${string}`;
  isV2: boolean;
};

/**
 * Resolve where edits for `orgName` should be written. v2 first (the
 * PermissionedResolver is invisible to v1-registry discovery), then v1.
 */
export async function resolveEnsEditTarget(input: {
  orgName: string;
  viewer?: Address;
}): Promise<EnsEditTarget | null> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return null;
  const client = createSoulVaultPublicClient(config);
  const normalized = normalize(input.orgName);
  const node = namehash(normalized);

  const v2 = await resolveEnsV2OrgRecord({ orgName: input.orgName, viewer: input.viewer }).catch(() => null);
  if (v2) return { resolver: v2.resolver, node, isV2: true };

  const resolver = await client.getEnsResolver({ name: normalized }).catch(() => null);
  if (!resolver || resolver === zeroAddress) return null;
  return { resolver, node, isV2: false };
}

export async function readOrgTextRecords(
  resolver: Address,
  node: `0x${string}`,
  keys: readonly OrgTextKey[] = ORG_TEXT_KEYS,
): Promise<Record<string, string>> {
  const config = getBrowserSoulVaultClientConfig();
  if (!config) return {};
  const client = createSoulVaultPublicClient(config);
  const entries = await Promise.all(
    keys.map(async (key) => {
      const value = (await client
        .readContract({
          address: resolver,
          abi: TEXT_ABI,
          functionName: "text",
          args: [node, key],
        })
        .catch(() => null)) as string | null;
      return [key, value ?? ""] as const;
    }),
  );
  return Object.fromEntries(entries.filter(([, value]) => value !== ""));
}

const TEXT_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const SET_TEXT_ABI = [
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
  },
] as const;

const MULTICALL_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "", type: "bytes[]" }],
  },
] as const;

/** Encode one setText(bytes32,string,string) calldata blob. */
export function encodeSetText(node: `0x${string}`, key: string, value: string): Hex {
  return encodeFunctionData({
    abi: SET_TEXT_ABI,
    functionName: "setText",
    args: [node, key, value],
  });
}

/** Validate an avatar value — either a data URI (base64) or an http(s)/ipfs URL. */
export function validateAvatarValue(value: string): string | null {
  if (!value) return null;
  if (value.startsWith("data:image/")) {
    const base64 = value.split(",")[1] ?? "";
    const bytes = Math.floor((base64.length * 3) / 4);
    if (bytes > MAX_AVATAR_DATA_URI_BYTES) {
      return `Image is too large for a text record (max ${Math.round(MAX_AVATAR_DATA_URI_BYTES / 1024)} KB, got ~${Math.round(bytes / 1024)} KB)`;
    }
    return null;
  }
  if (/^https?:\/\//i.test(value) || /^(ipfs|ar):/.test(value)) return null;
  return "Avatar must be an image data URI, https URL, or ipfs/ar URI";
}

/** Decode an image file into a base64 data URI (for the avatar upload path). */
export function fileToImageDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:image/")) {
        resolve(reader.result);
      } else {
        reject(new Error("Not a readable image file"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read the file"));
    reader.readAsDataURL(file);
  });
}

export type OrgTextSaveResult = {
  txHashes: Record<string, `0x${string}`>;
  skipped: OrgTextKey[];
};

/**
 * Send setText for every record whose value differs from `current`. When more
 * than one record changed, all of them ride a single `multicall(bytes[])`
 * transaction on the resolver (the PermissionedResolver preserves msg.sender
 * semantics, so the caller's setter roles apply to every inner call). If the
 * batch reverts, fall back to per-field sends so one bad record can't block
 * the others.
 */
export async function saveOrgTextRecords(input: {
  from: Address;
  target: EnsEditTarget;
  records: Record<string, string>;
  current: Record<string, string>;
}): Promise<OrgTextSaveResult> {
  const changed = ORG_TEXT_KEYS.filter(
    (key) => (input.records[key] ?? "") !== (input.current[key] ?? "") && (input.records[key] ?? "") !== "",
  );
  if (changed.length === 0) return { txHashes: {}, skipped: [] };

  if (changed.length > 1) {
    try {
      const hash = await sendWalletTransaction({
        from: input.from,
        to: input.target.resolver,
        data: encodeFunctionData({
          abi: MULTICALL_ABI,
          functionName: "multicall",
          args: [changed.map((key) => encodeSetText(input.target.node, key, input.records[key] ?? ""))],
        }),
      });
      const receipt = await waitForWalletReceipt(hash);
      if (receipt.status === "success") {
        return { txHashes: Object.fromEntries(changed.map((key) => [key, hash])), skipped: [] };
      }
      // Reverted at execution — fall through to per-field sends to isolate the failure.
    } catch {
      // Pre-flight refused the batch — fall through to per-field sends.
    }
  }

  const txHashes: Record<string, `0x${string}`> = {};
  for (const key of changed) {
    const hash = await sendWalletTransaction({
      from: input.from,
      to: input.target.resolver,
      data: encodeSetText(input.target.node, key, input.records[key] ?? ""),
    });
    const receipt = await waitForWalletReceipt(hash);
    if (receipt.status !== "success") {
      throw new Error(`setText(${key}) reverted (tx ${hash}).`);
    }
    txHashes[key] = hash;
  }
  return { txHashes, skipped: [] };
}

// ---------------------------------------------------------------------------
// ENSv2 pointer repair — the `soulvault.ensv2Registry` mirror record is what
// makes a v2 org discoverable without knowing the registering wallet. When it
// is missing (org wizard interrupted at the mirror step), v1-style readers see
// owner 0x0 and write flows fall back to broken probes. Repair = locate the
// org registry via the CREATE2 recompute (no local artifacts), then rewrite
// the pointer on the org's PermissionedResolver.
// ---------------------------------------------------------------------------

export type EnsV2PointerRepairResult = {
  /** null = pointer already present and correct (no tx sent). */
  txHash: `0x${string}` | null;
  registry: Address;
  owner: Address;
};

export async function repairEnsV2RegistryPointer(input: {
  from: Address;
  orgName: string;
}): Promise<EnsV2PointerRepairResult> {
  const record = await resolveEnsV2OrgRecord({ orgName: input.orgName, viewer: input.from });
  if (!record) {
    throw new Error(
      `No ENSv2 org registry could be proven for ${input.orgName} from wallet ${input.from} — ` +
        `run the repair from the wallet that registered the name (the CREATE2 probe is wallet-bound).`,
    );
  }
  if (!record.resolver) {
    throw new Error(
      `${input.orgName}'s ENSv2 registry has no resolver attached — re-run the organization wizard to attach one.`,
    );
  }
  const config = getBrowserSoulVaultClientConfig();
  if (!config) throw new Error("SoulVault dashboard config missing.");
  const client = createSoulVaultPublicClient(config);
  const normalized = normalize(input.orgName);
  const node = namehash(normalized);
  const current = (await client
    .readContract({
      address: record.resolver,
      abi: TEXT_ABI,
      functionName: "text",
      args: [node, ENSV2_REGISTRY_TEXT_KEY],
    })
    .catch(() => null)) as string | null;
  const existing = current ? decodeEnsV2RegistryRecord(current) : null;
  if (existing && existing.registry === record.registry && existing.owner === record.owner) {
    // Already mirrored — nothing to repair.
    return { txHash: null, registry: record.registry, owner: record.owner };
  }
  const hash = await sendWalletTransaction({
    from: input.from,
    to: record.resolver,
    data: encodeFunctionData({
      abi: SET_TEXT_ABI,
      functionName: "setText",
      args: [
        node,
        ENSV2_REGISTRY_TEXT_KEY,
        encodeEnsV2RegistryRecord({
          registry: record.registry,
          owner: record.owner,
          // On overwrite repair keep the original deployment time when known.
          deployedAt: existing?.deployedAt ?? new Date().toISOString(),
        }),
      ],
    }),
  });
  const receipt = await waitForWalletReceipt(hash);
  if (receipt.status !== "success") {
    throw new Error(`setText(${ENSV2_REGISTRY_TEXT_KEY}) reverted (tx ${hash}).`);
  }
  return { txHash: hash, registry: record.registry, owner: record.owner };
}
