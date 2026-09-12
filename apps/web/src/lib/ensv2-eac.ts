/**
 * Browser-side ENSv2 EAC role delegation (dashboard twin of
 * packages/node/src/ensv2-grants.ts). Grants/revoke/reads roles on a name's
 * resource in the org's PermissionedRegistry — the ENSv2 scoped-delegation
 * primitive: the agent wallet can then self-serve its own ENS records without
 * the org wallet ever signing.
 *
 * All calls take a fully-qualified name and resolve the holding registry via
 * the same hierarchy walk the read paths use, so callers never handle
 * registry addresses or resource IDs directly.
 */
import { encodeFunctionData, labelhash, type Address, type PublicClient } from "viem";

import { sendWalletTransaction, waitForWalletReceipt } from "@/lib/wallet-tx";
import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { readEnsV2OrgContext, normalizeEnsV2LabelState } from "@/lib/ens-writes";
import { ensV2OrgRoot } from "@/lib/ens-writes";

/** RegistryRolesLib bit positions (nybble-packed) — mirrors ensv2-grants.ts. */
export const ENSV2_ROLE_NAMES = {
  registrar: 1n << 0n,
  "register-reserved": 1n << 4n,
  "set-parent": 1n << 8n,
  unregister: 1n << 12n,
  renew: 1n << 16n,
  "set-subregistry": 1n << 20n,
  "set-resolver": 1n << 24n,
} as const;

export type EnsV2RoleName = keyof typeof ENSV2_ROLE_NAMES;

export function formatEnsV2RoleBitmap(bitmap: bigint): EnsV2RoleName[] {
  return Object.entries(ENSV2_ROLE_NAMES)
    .filter(([, bit]) => (bitmap & bit) !== 0n)
    .map(([name]) => name as EnsV2RoleName);
}

/** The delegation UI's sensible presets (self-serve record management). */
export const SELF_SERVE_ROLES: EnsV2RoleName[] = ["set-resolver", "renew"];

const REGISTRY_GRANT_ABI = [
  {
    type: "function",
    name: "grantRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeRoles",
    stateMutability: "nonpayable",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "roleBitmap", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "roles",
    stateMutability: "view",
    inputs: [
      { name: "resource", type: "uint256" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type NameEacContext = {
  fullName: string;
  registry: Address;
  /** Resource (token) id for the name's own label, in the holding registry. */
  resource: bigint;
};

/**
 * Locate the registry + resource holding `fullName`'s token. For names under
 * the org (e.g. `ops.<org>.eth`, `<agent>.<swarm>.<org>.eth`) the token lives
 * in the org's registry keyed by the name's own labelhash. The org registry is
 * located via readEnsV2OrgContext (pointer record / CREATE2 from the viewer).
 */
export async function resolveNameEacContext(input: {
  fullName: string;
  viewer: Address;
  client: PublicClient;
}): Promise<NameEacContext | null> {
  const orgRoot = ensV2OrgRoot(input.fullName);
  const v2 = await readEnsV2OrgContext(orgRoot, input.viewer).catch(() => null);
  if (!v2) return null;
  const topLabel = input.fullName.split(".")[0];
  const anyId = BigInt(labelhash(topLabel));
  // getState(anyId) → resource (token id) — grantRoles/revokeRoles accept any
  // id of the resource, so the name's own labelhash works directly.
  const rawState = (await input.client
    .readContract({
      address: v2.registry,
      abi: [
        {
          type: "function",
          name: "getState",
          inputs: [{ name: "anyId", type: "uint256" }],
          outputs: [
            {
              type: "tuple",
              components: [
                { type: "uint8" },
                { type: "uint64" },
                { type: "address" },
                { type: "uint256" },
                { type: "uint256" },
              ],
              stateMutability: "view",
            },
          ],
        },
      ] as const,
      functionName: "getState",
      args: [anyId],
    })
    .catch(() => null)) as unknown;
  // getState returns [status, expiry, latestOwner, tokenId, resource]; the
  // resource is what roles are keyed on. Reuse the normalizer for shape
  // tolerance, then read the tuple's resource directly (component 4).
  const state = normalizeEnsV2LabelState(rawState);
  if (!state) return null;
  const parts = Array.isArray(rawState) ? rawState : null;
  const resource = parts ? BigInt(parts[4]) : anyId;
  return { fullName: input.fullName, registry: v2.registry, resource };
}

/** Read the roles `account` holds on `fullName`'s resource. */
export async function readNameEacRoles(input: {
  ctx: NameEacContext;
  client: PublicClient;
  account: Address;
}): Promise<{ bitmap: bigint; roles: EnsV2RoleName[] }> {
  const bitmap = (await input.client
    .readContract({
      address: input.ctx.registry,
      abi: REGISTRY_GRANT_ABI,
      functionName: "roles",
      args: [input.ctx.resource, input.account],
    })
    .catch(() => 0n)) as bigint;
  return { bitmap, roles: formatEnsV2RoleBitmap(bitmap) };
}

/** Grant roles on `fullName`'s resource (EAC semantics: hold-what-you-grant). */
export async function grantNameEacRoles(input: {
  from: Address;
  fullName: string;
  ctx: NameEacContext;
  account: Address;
  roleBitmap: bigint;
}): Promise<Hex> {
  const txHash = await sendWalletTransaction({
    from: input.from,
    to: input.ctx.registry,
    data: encodeFunctionData({
      abi: REGISTRY_GRANT_ABI,
      functionName: "grantRoles",
      args: [input.ctx.resource, input.roleBitmap, input.account],
    }),
    chainId: SEPOLIA_CHAIN_ID,
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`grantRoles reverted (tx ${txHash}).`);
  return txHash;
}

/** Revoke roles on `fullName`'s resource (agent offboarding / rotation). */
export async function revokeNameEacRoles(input: {
  from: Address;
  fullName: string;
  ctx: NameEacContext;
  account: Address;
  roleBitmap: bigint;
}): Promise<Hex> {
  const txHash = await sendWalletTransaction({
    from: input.from,
    to: input.ctx.registry,
    data: encodeFunctionData({
      abi: REGISTRY_GRANT_ABI,
      functionName: "revokeRoles",
      args: [input.ctx.resource, input.roleBitmap, input.account],
    }),
    chainId: SEPOLIA_CHAIN_ID,
  });
  const receipt = await waitForWalletReceipt(txHash);
  if (receipt.status !== "success") throw new Error(`revokeRoles reverted (tx ${txHash}).`);
  return txHash;
}

type Hex = `0x${string}`;
