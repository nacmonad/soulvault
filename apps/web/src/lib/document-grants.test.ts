import { describe, expect, it } from "vitest";
import {
  redactAndEncryptDocument,
  serializePublicDocumentBundle,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";
import type { Hex } from "viem";

import {
  assertRecipientMatchesAttestation,
  latestRehydrationRequests,
  parsePastedAttestation,
  pendingRehydrationRequests,
  slotsFromPublicBundle,
} from "./document-grants";

const charlie = "0x0000000000000000000000000000000000000c4e";

function sampleAttestation(expiry: bigint | string): SignedRehydrationKeyAttestation {
  return {
    domain: {
      name: "SoulVaultDocuments",
      version: "1",
      chainId: 11155111,
      verifyingContract: "0x1111111111111111111111111111111111111111",
    },
    primaryType: "RehydrationKey",
    types: {
      RehydrationKey: [
        { name: "wallet", type: "address" },
        { name: "rehydrationPublicKey", type: "bytes" },
        { name: "expiry", type: "uint64" },
      ],
    },
    message: {
      wallet: charlie,
      rehydrationPublicKey: `0x${"ab".repeat(65)}`,
      expiry: expiry as bigint,
    },
    signature: `0x${"cd".repeat(65)}`,
  };
}

describe("parsePastedAttestation", () => {
  it("coerces JSON string expiry back to bigint", () => {
    const pasted = JSON.stringify(sampleAttestation(1_800_000_000n), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    const parsed = parsePastedAttestation(pasted);
    expect(parsed.message.expiry).toBe(1_800_000_000n);
    expect(parsed.message.wallet.toLowerCase()).toBe(charlie);
  });

  it("rejects malformed JSON", () => {
    expect(() => parsePastedAttestation("{nope")).toThrow("Attestation JSON is invalid.");
  });
});

describe("assertRecipientMatchesAttestation", () => {
  const attestation = sampleAttestation(1n);

  it("allows an empty recipient (attestation wallet is the recipient)", () => {
    expect(() => assertRecipientMatchesAttestation("", attestation)).not.toThrow();
  });

  it("fails closed when the pasted address is not the attested wallet", () => {
    expect(() =>
      assertRecipientMatchesAttestation("0x000000000000000000000000000000000000dEaD", attestation),
    ).toThrow("Pasted recipient does not match the attestation wallet.");
  });
});

describe("slotsFromPublicBundle", () => {
  it("reads entity type, marker, and occurrence count from the public artifact", () => {
    const document = redactAndEncryptDocument({
      text: "Patient TEST PERSON called 555-0100. TEST PERSON again.",
      spans: [
        { start: 8, end: 19, entityType: "PERSON", slotId: "person-1" },
        { start: 27, end: 35, entityType: "PHONE_NUMBER", slotId: "phone-1" },
        { start: 37, end: 48, entityType: "PERSON", slotId: "person-1" },
      ],
    });
    const slots = slotsFromPublicBundle(serializePublicDocumentBundle(document));
    expect(slots).toEqual([
      { slotId: "person-1", entityType: "PERSON", marker: "{{sv:person-1}}", occurrences: 2 },
      { slotId: "phone-1", entityType: "PHONE_NUMBER", marker: "{{sv:phone-1}}", occurrences: 1 },
    ]);
    expect(serializePublicDocumentBundle(document)).not.toMatch(/slotKeys/);
  });
});

describe("latestRehydrationRequests", () => {
  const docHash = `0x${"11".repeat(32)}` as Hex;
  const otherDoc = `0x${"22".repeat(32)}` as Hex;
  const mallory = "0x0000000000000000000000000000000000000d11";

  function request(input: {
    recipient: string;
    blockNumber: bigint;
    logIndex?: number;
    docHash?: Hex;
    pubkey?: string;
  }) {
    return {
      eventName: "RehydrationRequested" as const,
      sourceKind: "document" as const,
      source: "0x3333333333333333333333333333333333333333" as const,
      docHash: input.docHash ?? docHash,
      recipient: input.recipient as `0x${string}`,
      rehydrationPublicKey: input.pubkey ?? `0x${"ab".repeat(65)}`,
      selfieProof: "",
      blockNumber: input.blockNumber,
      logIndex: input.logIndex ?? 0,
      txHash: `0x${"44".repeat(32)}` as Hex,
    };
  }

  it("keeps the latest request per recipient in request order", () => {
    const requests = latestRehydrationRequests(
      [
        request({ recipient: charlie, blockNumber: 10n }),
        request({ recipient: mallory, blockNumber: 11n }),
        request({ recipient: charlie, blockNumber: 20n, pubkey: `0x${"cd".repeat(65)}` }),
        request({ recipient: charlie, blockNumber: 9n, docHash: otherDoc }),
      ],
      docHash,
    );
    expect(requests).toHaveLength(2);
    expect(requests[0].recipient.toLowerCase()).toBe(mallory);
    expect(requests[1].recipient.toLowerCase()).toBe(charlie);
    expect(requests[1].rehydrationPublicKey).toBe(`0x${"cd".repeat(65)}`);
    expect(requests[1].blockNumber).toBe(20n);
  });

  it("returns an empty list when nothing matches", () => {
    expect(latestRehydrationRequests([], docHash)).toEqual([]);
  });
});

describe("pendingRehydrationRequests", () => {
  const docHash = `0x${"11".repeat(32)}` as Hex;
  const otherDoc = `0x${"22".repeat(32)}` as Hex;
  const mallory = "0x0000000000000000000000000000000000000d11";

  function request(input: {
    recipient: string;
    blockNumber: bigint;
    logIndex?: number;
    docHash?: Hex;
  }) {
    return {
      eventName: "RehydrationRequested" as const,
      sourceKind: "document" as const,
      source: "0x3333333333333333333333333333333333333333" as const,
      docHash: input.docHash ?? docHash,
      recipient: input.recipient as `0x${string}`,
      rehydrationPublicKey: `0x${"ab".repeat(65)}`,
      selfieProof: "",
      blockNumber: input.blockNumber,
      logIndex: input.logIndex ?? 0,
      txHash: `0x${"44".repeat(32)}` as Hex,
    };
  }

  function grant(input: { recipient: string; docHash?: Hex; slotId?: string }) {
    return {
      eventName: "SlotKeyGranted" as const,
      sourceKind: "document" as const,
      source: "0x3333333333333333333333333333333333333333" as const,
      docHash: input.docHash ?? docHash,
      slotId: input.slotId ?? "slot-1",
      recipient: input.recipient as `0x${string}`,
      wrap: {
        algorithm: "secp256k1-ecdh-aes-256-gcm" as const,
        wrappedKey: "AAECAw==",
        ephemeralPublicKey: "04ab",
        nonce: "000102030405060708090a0b",
      },
      blockNumber: 50n,
      logIndex: 0,
      txHash: `0x${"55".repeat(32)}` as Hex,
    };
  }

  it("lists unanswered requests across docs and skips granted ones", () => {
    const pending = pendingRehydrationRequests(
      [
        request({ recipient: charlie, blockNumber: 10n }),
        request({ recipient: mallory, blockNumber: 11n }),
        grant({ recipient: charlie }),
        request({ recipient: mallory, docHash: otherDoc, blockNumber: 5n }),
      ],
      [docHash, otherDoc],
    );
    expect(pending).toHaveLength(2);
    expect(pending[0].recipient.toLowerCase()).toBe(mallory);
    expect(pending[0].docHash.toLowerCase()).toBe(otherDoc);
    expect(pending[1].recipient.toLowerCase()).toBe(mallory);
    expect(pending[1].docHash.toLowerCase()).toBe(docHash);
  });

  it("treats a single slot grant as delivery for the whole request", () => {
    const pending = pendingRehydrationRequests(
      [request({ recipient: charlie, blockNumber: 10n }), grant({ recipient: charlie, slotId: "a" })],
      [docHash],
    );
    expect(pending).toEqual([]);
  });

  it("returns an empty list when there are no requests", () => {
    expect(pendingRehydrationRequests([], [docHash])).toEqual([]);
  });
});
