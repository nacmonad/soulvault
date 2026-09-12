import { describe, expect, it, vi } from "vitest";
import {
  createSlotKeyGrantsForRecipient,
  DocumentProtocolError,
  loadOrCreateRehydrationKey,
  MemoryRehydrationKeyStore,
  redactAndEncryptDocument,
  serializePublicDocumentBundle,
  parsePublicDocumentBundle,
} from "@soulvault/protocol";

import {
  assertBundleAnchoredOnChain,
  bundleDocHash,
  compareAuthorSessionRun,
  diagnoseSlotGrant,
  evaluateSelfieProof,
  parsePastedSelfieProof,
  publicHydrationError,
  rehydrateSelfieSignal,
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
    expect(resolveWorldRehydrateGate({ appId: "app_test", rpId: "rp_test", rpUrl: "http://127.0.0.1:8787/" })).toEqual({
      mode: "required",
      appId: "app_test",
      action: WORLD_REHYDRATE_ACTION,
      rpId: "rp_test",
      rpUrl: "http://127.0.0.1:8787",
      environment: "staging",
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

  it("accepts an IDKit 3.0 selfie payload as the staging fixture", () => {
    const signal = rehydrateSelfieSignal(wallet, "0x" + "ab".repeat(32));
    expect(
      evaluateSelfieProof({
        proof: {
          protocol_version: "3.0",
          signal,
          responses: [{ identifier: "selfie", nullifier: "n-idkit" }],
        },
        expectedSignal: signal,
        consumedNullifiers: new Set(),
      }),
    ).toEqual({ ok: true, nullifier: "n-idkit" });
  });
});

describe("publicHydrationError", () => {
  it("prints protocol codes, never the original plaintext", () => {
    const cause = new DocumentProtocolError("UNAUTHORIZED_RECIPIENT", "Patient TEST PERSON must not leak");
    expect(publicHydrationError(cause)).toBe("UNAUTHORIZED_RECIPIENT");
    expect(publicHydrationError(cause)).not.toMatch(/TEST PERSON/);
  });
});

describe("diagnoseSlotGrant", () => {
  const wallet = "0x0000000000000000000000000000000000000c4e";

  async function setup() {
    const document = redactAndEncryptDocument({
      text: "Patient TEST PERSON called 555-0100.",
      spans: [{ start: 8, end: 19, entityType: "PERSON", slotId: "person-1" }],
    });
    const bundle = parsePublicDocumentBundle(serializePublicDocumentBundle(document));
    const recipient = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const otherKey = await loadOrCreateRehydrationKey({
      store: new MemoryRehydrationKeyStore(),
      keyId: "other",
    });
    const grants = createSlotKeyGrantsForRecipient({
      slotKeys: document.slotKeys,
      slotIds: ["person-1"],
      recipient: wallet,
      recipientPublicKey: recipient.publicKey,
    });
    return { document, bundle, recipient, otherKey, grants };
  }

  it("reports ok for a matching key and ciphertext", async () => {
    const { bundle, recipient, grants } = await setup();
    expect(
      diagnoseSlotGrant({
        artifact: bundle.artifact,
        encryptedSlots: bundle.encryptedSlots,
        recipientWallet: wallet,
        rehydrationKey: recipient,
        grant: grants[0],
      }),
    ).toEqual({ ok: true });
  });

  it("classifies a wrong rehydration key as the unwrap stage", async () => {
    const { bundle, otherKey, grants } = await setup();
    expect(
      diagnoseSlotGrant({
        artifact: bundle.artifact,
        encryptedSlots: bundle.encryptedSlots,
        recipientWallet: wallet,
        rehydrationKey: otherKey,
        grant: grants[0],
      }),
    ).toEqual({ ok: false, stage: "unwrap" });
  });

  it("classifies a slot key from a different redact run as slot-open failure", async () => {
    const { bundle, recipient } = await setup();
    // Same text, same deterministic slotId — fresh random slot keys.
    const rerun = redactAndEncryptDocument({
      text: "Patient TEST PERSON called 555-0100.",
      spans: [{ start: 8, end: 19, entityType: "PERSON", slotId: "person-1" }],
    });
    const staleGrants = createSlotKeyGrantsForRecipient({
      slotKeys: rerun.slotKeys,
      slotIds: ["person-1"],
      recipient: wallet,
      recipientPublicKey: recipient.publicKey,
    });
    expect(
      diagnoseSlotGrant({
        artifact: bundle.artifact,
        encryptedSlots: bundle.encryptedSlots,
        recipientWallet: wallet,
        rehydrationKey: recipient,
        grant: staleGrants[0],
      }),
    ).toEqual({ ok: false, stage: "slot-open" });
  });
});

describe("compareAuthorSessionRun", () => {
  function installSessionStorageStub() {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
    return values;
  }

  function seedSession(documentId: string, bundle: string | null) {
    const key = `soulvault.document.${documentId}`;
    if (bundle === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify({ documentId, slotKeys: [], bundle }));
  }

  it("reports match for the same redact run", () => {
    installSessionStorageStub();
    const bundle = sampleBundle();
    seedSession(bundle.artifact.documentId, serializePublicDocumentBundle(bundle));
    expect(compareAuthorSessionRun(bundle)).toBe("match");
    vi.unstubAllGlobals();
  });

  it("reports mismatch when the session was overwritten by a later redact run", () => {
    installSessionStorageStub();
    const bundle = sampleBundle();
    const rerun = parsePublicDocumentBundle(serializePublicDocumentBundle(sampleBundle()));
    // sampleBundle() re-runs redaction: fresh nonces under the same documentId.
    seedSession(bundle.artifact.documentId, serializePublicDocumentBundle(rerun));
    // If nonces happen to match (astronomically unlikely), skip the assertion.
    const sameRun = bundle.encryptedSlots[0].nonce === rerun.encryptedSlots[0].nonce;
    if (!sameRun) expect(compareAuthorSessionRun(bundle)).toBe("mismatch");
    vi.unstubAllGlobals();
  });

  it("reports no-session when this browser has no author session", () => {
    installSessionStorageStub();
    const bundle = sampleBundle();
    seedSession(bundle.artifact.documentId, null);
    expect(compareAuthorSessionRun(bundle)).toBe("no-session");
    vi.unstubAllGlobals();
  });

  it("reports no-session when localStorage is unavailable (node)", () => {
    vi.unstubAllGlobals();
    expect(compareAuthorSessionRun(sampleBundle())).toBe("no-session");
  });
});
