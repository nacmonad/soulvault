import { describe, expect, it } from "vitest";
import {
  DocumentProtocolError,
  redactAndEncryptDocument,
  serializePublicDocumentBundle,
  parsePublicDocumentBundle,
} from "@soulvault/protocol";

import {
  assertBundleAnchoredOnChain,
  bundleDocHash,
  evaluateSelfieProof,
  parsePastedSelfieProof,
  publicHydrationError,
  resolveWorldRehydrateGate,
  RehydrateGateError,
  WORLD_REHYDRATE_ACTION,
} from "./document-rehydrate";

function sampleBundle() {
  const document = redactAndEncryptDocument({
    text: "Patient TEST PERSON called 555-0100.",
    spans: [
      { start: 8, end: 19, entityType: "PERSON", slotId: "person-1" },
      { start: 27, end: 35, entityType: "PHONE_NUMBER", slotId: "phone-1" },
    ],
  });
  return parsePublicDocumentBundle(serializePublicDocumentBundle(document));
}

describe("assertBundleAnchoredOnChain", () => {
  it("accepts a bundle whose docHash and slots match the registry", () => {
    const bundle = sampleBundle();
    const docHash = bundleDocHash(bundle.artifact.documentId);
    const anchored = assertBundleAnchoredOnChain({
      bundle,
      published: { docHash, slotIds: bundle.artifact.slots.map((slot) => slot.slotId) },
    });
    expect(anchored.docHash).toBe(docHash);
  });

  it("fails closed when the docHash is not in the registry", () => {
    const bundle = sampleBundle();
    expect(() => assertBundleAnchoredOnChain({ bundle, published: undefined })).toThrow(RehydrateGateError);
    try {
      assertBundleAnchoredOnChain({ bundle, published: undefined });
    } catch (cause) {
      expect(publicHydrationError(cause)).not.toMatch(/TEST PERSON/);
      expect(publicHydrationError(cause)).not.toMatch(/555-0100/);
    }
  });

  it("fails closed when on-chain slotIds do not cover the artifact", () => {
    const bundle = sampleBundle();
    expect(() =>
      assertBundleAnchoredOnChain({
        bundle,
        published: { docHash: bundleDocHash(bundle.artifact.documentId), slotIds: ["person-1"] },
      }),
    ).toThrow(/do not cover the artifact/);
  });

  it("fails closed when an encrypted slot is missing from the artifact", () => {
    const bundle = sampleBundle();
    const tampered = {
      ...bundle,
      encryptedSlots: [
        ...bundle.encryptedSlots,
        { ...bundle.encryptedSlots[0], slotId: "ghost-slot" },
      ],
    };
    expect(() =>
      assertBundleAnchoredOnChain({
        bundle: tampered,
        published: {
          docHash: bundleDocHash(bundle.artifact.documentId),
          slotIds: [...bundle.artifact.slots.map((slot) => slot.slotId), "ghost-slot"],
        },
      }),
    ).toThrow(/Encrypted slots do not match/);
  });
});

describe("resolveWorldRehydrateGate", () => {
  it("stays off when World is unset (dev default)", () => {
    expect(resolveWorldRehydrateGate({})).toEqual({ mode: "off", unconfigured: false });
  });

  it("surfaces an unconfigured flag in production instead of skipping silently", () => {
    expect(resolveWorldRehydrateGate({ nodeEnv: "production" })).toEqual({
      mode: "off",
      unconfigured: true,
    });
  });

  it("turns the gate on when an app id is set", () => {
    expect(resolveWorldRehydrateGate({ appId: "app_test" })).toEqual({
      mode: "required",
      appId: "app_test",
      action: WORLD_REHYDRATE_ACTION,
    });
  });

  it("errors when the gate is required but the app id is missing", () => {
    const gate = resolveWorldRehydrateGate({ gate: "required" });
    expect(gate.mode).toBe("error");
  });

  it("can force the gate off even if an app id is present", () => {
    expect(resolveWorldRehydrateGate({ appId: "app_test", gate: "off" })).toEqual({ mode: "off" });
  });
});

describe("evaluateSelfieProof", () => {
  const wallet = "0x0000000000000000000000000000000000000c4e";

  it("accepts credential 11 bound to the connected wallet", () => {
    expect(
      evaluateSelfieProof({
        proof: { nullifier: "n1", credentialId: 11, signal: wallet },
        expectedSignal: wallet,
        consumedNullifiers: new Set(),
      }),
    ).toEqual({ ok: true, nullifier: "n1" });
  });

  it("rejects a proof bound to a different wallet", () => {
    expect(
      evaluateSelfieProof({
        proof: { nullifier: "n1", credentialId: 11, signal: "0x000000000000000000000000000000000000dEaD" },
        expectedSignal: wallet,
        consumedNullifiers: new Set(),
      }),
    ).toEqual({ ok: false, reason: "signal-mismatch" });
  });

  it("rejects a non-selfie credential", () => {
    expect(
      evaluateSelfieProof({
        proof: { nullifier: "n1", credentialId: 1, signal: wallet },
        expectedSignal: wallet,
        consumedNullifiers: new Set(),
      }),
    ).toEqual({ ok: false, reason: "wrong-credential" });
  });

  it("rejects nullifier replay", () => {
    expect(
      evaluateSelfieProof({
        proof: { nullifier: "n1", credentialId: 11, signal: wallet },
        expectedSignal: wallet,
        consumedNullifiers: new Set(["n1"]),
      }),
    ).toEqual({ ok: false, reason: "nullifier-replay" });
  });

  it("rejects malformed pasted JSON", () => {
    expect(() => parsePastedSelfieProof("{nope")).toThrow(RehydrateGateError);
  });
});

describe("publicHydrationError", () => {
  it("prints protocol codes, never the original plaintext", () => {
    const cause = new DocumentProtocolError("UNAUTHORIZED_RECIPIENT", "Patient TEST PERSON must not leak");
    expect(publicHydrationError(cause)).toBe("UNAUTHORIZED_RECIPIENT");
    expect(publicHydrationError(cause)).not.toMatch(/TEST PERSON/);
  });
});
