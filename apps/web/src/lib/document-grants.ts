import { isAddress, isAddressEqual, type Address } from "viem";
import {
  parsePublicDocumentBundle,
  type RedactedSlotReference,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";

export function parsePastedAttestation(text: string): SignedRehydrationKeyAttestation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Attestation JSON is invalid.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Attestation JSON is invalid.");
  }
  const value = parsed as {
    message?: { wallet?: unknown; rehydrationPublicKey?: unknown; expiry?: unknown };
    signature?: unknown;
  };
  if (!value.message || typeof value.message !== "object" || typeof value.signature !== "string") {
    throw new Error("Attestation JSON is invalid.");
  }
  let expiry: bigint;
  try {
    expiry =
      typeof value.message.expiry === "bigint"
        ? value.message.expiry
        : BigInt(String(value.message.expiry));
  } catch {
    throw new Error("Attestation JSON is invalid.");
  }
  return {
    ...(parsed as SignedRehydrationKeyAttestation),
    message: {
      wallet: String(value.message.wallet),
      rehydrationPublicKey: String(value.message.rehydrationPublicKey),
      expiry,
    },
  };
}

export function assertRecipientMatchesAttestation(
  recipient: string,
  attestation: SignedRehydrationKeyAttestation,
) {
  const trimmed = recipient.trim();
  if (!trimmed) return;
  if (!isAddress(trimmed)) throw new Error("Recipient is not an address.");
  if (!isAddressEqual(trimmed, attestation.message.wallet as Address)) {
    throw new Error("Pasted recipient does not match the attestation wallet.");
  }
}

export function slotsFromPublicBundle(bundle: string): RedactedSlotReference[] {
  try {
    return parsePublicDocumentBundle(bundle).artifact.slots;
  } catch {
    return [];
  }
}
