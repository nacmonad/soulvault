import { isAddress, isAddressEqual, type Address } from "viem";
import {
  parsePublicDocumentBundle,
  type RedactedSlotReference,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";

import type { RehydrationRequestedEvent, SoulVaultDocumentEvent } from "@/lib/onchain/types";

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

export type PendingRehydrationRequest = {
  docHash: RehydrationRequestedEvent["docHash"];
  recipient: Address;
  rehydrationPublicKey: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
};

/**
 * Latest onchain hydration request per recipient for one document, in request
 * order. A newer request for the same recipient is that wallet's key rotation
 * (the loss story) — the author grants against the latest key.
 */
export function latestRehydrationRequests(
  events: readonly SoulVaultDocumentEvent[],
  docHash: string,
): PendingRehydrationRequest[] {
  const target = docHash.toLowerCase();
  const latest = new Map<string, PendingRehydrationRequest>();
  for (const event of events) {
    if (event.eventName !== "RehydrationRequested") continue;
    if (event.docHash.toLowerCase() !== target) continue;
    latest.set(event.recipient.toLowerCase(), {
      docHash: event.docHash,
      recipient: event.recipient,
      rehydrationPublicKey: event.rehydrationPublicKey,
      blockNumber: event.blockNumber,
      txHash: event.txHash,
      logIndex: event.logIndex,
    });
  }
  return [...latest.values()].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
  );
}

export type PendingRehydrationRequestSummary = PendingRehydrationRequest & {
  /** True once ANY SlotKeyGranted reached this recipient for this document. */
  granted: boolean;
};

/**
 * Outstanding hydration requests across a set of documents (usually everything
 * the connected wallet authored), for the grants-page callout. A request is
 * pending until at least one grant has been delivered to that recipient for
 * that document. Ordered oldest-first.
 */
export function pendingRehydrationRequests(
  events: readonly SoulVaultDocumentEvent[],
  docHashes: readonly string[],
): PendingRehydrationRequestSummary[] {
  const grantedRecipients = new Set<string>();
  for (const event of events) {
    if (event.eventName !== "SlotKeyGranted") continue;
    grantedRecipients.add(`${event.docHash.toLowerCase()}:${event.recipient.toLowerCase()}`);
  }
  const pending: PendingRehydrationRequestSummary[] = [];
  for (const docHash of docHashes) {
    for (const request of latestRehydrationRequests(events, docHash)) {
      if (grantedRecipients.has(`${request.docHash.toLowerCase()}:${request.recipient.toLowerCase()}`)) {
        continue;
      }
      pending.push({ ...request, granted: false });
    }
  }
  return pending.sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
  );
}
