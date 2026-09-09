import { encodeFunctionData, type Address, type Hex } from "viem";
import type { SecpWrappedKey } from "@soulvault/protocol";

import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { sendWalletTransaction } from "@/lib/wallet-tx";

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

export function documentRegistryAddress(): Address | null {
  const config = getBrowserSoulVaultClientConfig();
  return config?.deployments.find((item) => item.kind === "document")?.address ?? null;
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
}): Promise<Hex> {
  const to = documentRegistryAddress();
  if (!to) throw new Error("No document registry in NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS.");
  const data = encodeFunctionData({
    abi: WRITE_ABI,
    functionName: "publishDocument",
    args: [asDocHash(input.documentId), input.slotIds],
  });
  return sendWalletTransaction({ from: input.from, to, data });
}

export async function grantSlotKey(input: {
  from: Address;
  documentId: string;
  slotId: string;
  recipient: Address;
  wrap: SecpWrappedKey;
}): Promise<Hex> {
  const to = documentRegistryAddress();
  if (!to) throw new Error("No document registry in NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS.");
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
  return sendWalletTransaction({ from: input.from, to, data });
}
