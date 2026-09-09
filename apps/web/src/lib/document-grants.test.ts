import { describe, expect, it } from "vitest";
import {
  redactAndEncryptDocument,
  serializePublicDocumentBundle,
  type SignedRehydrationKeyAttestation,
} from "@soulvault/protocol";

import {
  assertRecipientMatchesAttestation,
  parsePastedAttestation,
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
