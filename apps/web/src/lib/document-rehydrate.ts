import {
  DocumentProtocolError,
  rehydrateGrantedDocument,
  type EncryptedDocumentSlot,
  type PublicDocumentBundle,
  type RedactedDocumentArtifact,
  type RehydrationKey,
  type SecpWrappedKey,
} from "@soulvault/protocol";
import type { Hex } from "viem";

/** Same action string as the node World PoC. Protocol stays free of World types. */
export const WORLD_REHYDRATE_ACTION = "soulvault-request-rehydrate";

export class RehydrateGateError extends Error {
  readonly name = "RehydrateGateError";
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function bundleDocHash(documentId: string): Hex {
  const hex = documentId.startsWith("0x") ? documentId : `0x${documentId}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new RehydrateGateError("INVALID_ARTIFACT", "documentId is not a 32-byte hash");
  }
  return hex as Hex;
}

export type WorldRehydrateGate =
  | { mode: "off"; unconfigured?: boolean }
  | {
      mode: "required";
      appId: string;
      action: string;
      rpId: string;
      rpUrl: string;
      environment: "staging" | "production";
    }
  | { mode: "error"; message: string };

export function rehydrateSelfieSignal(wallet: string, docHash: string): string {
  const addr = wallet.trim().toLowerCase();
  const hash = docHash.trim().toLowerCase();
  const withPrefix = hash.startsWith("0x") ? hash : `0x${hash}`;
  return `${addr}:${withPrefix}`;
}

export function resolveWorldRehydrateGate(
  env: {
    appId?: string;
    rpId?: string;
    rpUrl?: string;
    environment?: string;
    gate?: string;
    nodeEnv?: string;
  } = {},
): WorldRehydrateGate {
  const appId = env.appId?.trim() ?? "";
  const gate = (env.gate ?? "").trim().toLowerCase();
  const environment = env.environment?.trim().toLowerCase() === "production" ? "production" : "staging";
  if (gate === "off") return { mode: "off" };
  if (appId) {
    return {
      mode: "required",
      appId,
      action: WORLD_REHYDRATE_ACTION,
      rpId: env.rpId?.trim() ?? "",
      rpUrl: env.rpUrl?.trim().replace(/\/+$/, "") ?? "",
      environment,
    };
  }
  if (gate === "on" || gate === "required") {
    return {
      mode: "error",
      message: "World Selfie Check is required but NEXT_PUBLIC_WORLD_APP_ID is unset.",
    };
  }
  return { mode: "off", unconfigured: env.nodeEnv === "production" };
}

export function getBrowserWorldRehydrateGate(): WorldRehydrateGate {
  return resolveWorldRehydrateGate({
    appId: process.env.NEXT_PUBLIC_WORLD_APP_ID,
    rpId: process.env.NEXT_PUBLIC_WORLD_RP_ID,
    rpUrl: process.env.NEXT_PUBLIC_WORLD_RP_URL,
    environment: process.env.NEXT_PUBLIC_WORLD_ENVIRONMENT,
    gate: process.env.NEXT_PUBLIC_WORLD_GATE,
    nodeEnv: process.env.NODE_ENV,
  });
}

export type PublishedDocumentAnchor = {
  docHash: string;
  slotIds: readonly string[];
};

/**
 * Integrity gate before any unwrap. Tampered / unpublished bundles never
 * become hydratable. Ciphertext substitution fails later at AES-GCM open
 * (`AUTHENTICATION_FAILED`) with no plaintext in the error.
 */
export function assertBundleAnchoredOnChain(input: {
  bundle: PublicDocumentBundle;
  published: PublishedDocumentAnchor | undefined;
}): { docHash: Hex } {
  const docHash = bundleDocHash(input.bundle.artifact.documentId);
  if (!input.published) {
    throw new RehydrateGateError("REGISTRY_MISSING", "docHash is not in the registry event cache.");
  }
  if (input.published.docHash.toLowerCase() !== docHash.toLowerCase()) {
    throw new RehydrateGateError("DOC_HASH_MISMATCH", "Bundle documentId does not match the on-chain docHash.");
  }

  const onChain = new Set(input.published.slotIds);
  const artifactIds = input.bundle.artifact.slots.map((slot) => slot.slotId);
  const artifactSet = new Set(artifactIds);

  for (const slotId of artifactIds) {
    if (!onChain.has(slotId)) {
      throw new RehydrateGateError("SLOT_COVERAGE", "On-chain slotIds do not cover the artifact.");
    }
  }
  for (const slot of input.bundle.encryptedSlots) {
    if (!artifactSet.has(slot.slotId) || !onChain.has(slot.slotId)) {
      throw new RehydrateGateError("SLOT_COVERAGE", "Encrypted slots do not match the published artifact.");
    }
  }
  return { docHash };
}

export type SelfieCheckProof = {
  nullifier: string;
  credentialId: number;
  signal: string;
};

export function parseSelfieProof(raw: unknown): SelfieCheckProof | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as {
    nullifier?: unknown;
    credentialId?: unknown;
    signal?: unknown;
    responses?: unknown;
  };
  const responses = Array.isArray(value.responses) ? value.responses : [];
  const selfie = responses.find((row) => {
    if (!row || typeof row !== "object") return false;
    const id = (row as { identifier?: unknown }).identifier;
    return typeof id === "string" && (id === "selfie" || id === "face");
  }) as { nullifier?: unknown } | undefined;
  const nullifier =
    typeof value.nullifier === "string"
      ? value.nullifier
      : typeof selfie?.nullifier === "string"
        ? selfie.nullifier
        : "";
  if (!nullifier) return null;
  const signal = typeof value.signal === "string" ? value.signal : "";
  const credentialId =
    typeof value.credentialId === "number"
      ? value.credentialId
      : typeof value.credentialId === "string"
        ? Number(value.credentialId)
        : selfie
          ? 11
          : NaN;
  if (!Number.isInteger(credentialId)) return null;
  return { nullifier, credentialId, signal };
}

export function evaluateSelfieProof(input: {
  proof: unknown;
  expectedSignal: string;
  consumedNullifiers: ReadonlySet<string>;
}): { ok: true; nullifier: string } | { ok: false; reason: string } {
  const proof = parseSelfieProof(input.proof);
  if (!proof) return { ok: false, reason: "malformed-proof" };
  if (proof.credentialId !== 11) return { ok: false, reason: "wrong-credential" };
  const bound = proof.signal.length > 0 ? proof.signal : input.expectedSignal;
  if (bound.toLowerCase() !== input.expectedSignal.toLowerCase()) {
    return { ok: false, reason: "signal-mismatch" };
  }
  if (input.consumedNullifiers.has(proof.nullifier)) return { ok: false, reason: "nullifier-replay" };
  return { ok: true, nullifier: proof.nullifier };
}

export function parsePastedSelfieProof(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new RehydrateGateError("MALFORMED_PROOF", "Selfie Check proof JSON is invalid.");
  }
}

/**
 * Per-slot verdict for a delivered grant: can THIS browser unwrap it, and if
 * not, did the failure happen at ECDH unwrap (wrong rehydration key) or at the
 * AES-GCM open (slot key from a different redact run than this bundle). The
 * stage distinction is the whole diagnosis — but protocol messages are not
 * guaranteed plaintext-free, so we classify by message and never echo it.
 */
export function diagnoseSlotGrant(input: {
  artifact: RedactedDocumentArtifact;
  encryptedSlots: EncryptedDocumentSlot[];
  recipientWallet: string;
  rehydrationKey: RehydrationKey;
  grant: { slotId: string; recipient: string; wrap: SecpWrappedKey };
}): { ok: true } | { ok: false; stage: "unwrap" | "slot-open" } {
  try {
    rehydrateGrantedDocument({
      artifact: input.artifact,
      encryptedSlots: input.encryptedSlots,
      recipientWallet: input.recipientWallet,
      rehydrationKey: input.rehydrationKey,
      // Force the fingerprint filter to pass so a failed unwrap surfaces as
      // AUTHENTICATION_FAILED (wrap/key mismatch), not UNAUTHORIZED_RECIPIENT.
      grants: [
        {
          slotId: input.grant.slotId,
          recipient: input.grant.recipient,
          recipientKeyFingerprint: input.rehydrationKey.fingerprint,
          wrap: input.grant.wrap,
        },
      ],
    });
    return { ok: true };
  } catch (cause) {
    const message = cause instanceof DocumentProtocolError ? cause.message : "";
    if (message.includes("Could not authenticate encrypted slot")) return { ok: false, stage: "slot-open" };
    return { ok: false, stage: "unwrap" };
  }
}

/**
 * Compares the uploaded bundle's slot nonces against the author session in
 * localStorage (same redact run?) — slotIds are deterministic per entity
 * value, so a re-run of Redact reuses the documentId while rotating every
 * slot key; grants then open the new ciphertexts but not this bundle's.
 */
export function compareAuthorSessionRun(bundle: PublicDocumentBundle): "match" | "mismatch" | "no-session" {
  // Node 22+ exposes a global localStorage binding without a backing file,
  // so feature-detect the methods, not the binding.
  const store = typeof localStorage !== "undefined" && typeof localStorage.getItem === "function" ? localStorage : null;
  if (!store) return "no-session";
  const raw = store.getItem(`soulvault.document.${bundle.artifact.documentId.toLowerCase()}`);
  if (!raw) return "no-session";
  try {
    const session = JSON.parse(raw) as { bundle?: string };
    if (typeof session.bundle !== "string") return "no-session";
    const sessionBundle = JSON.parse(session.bundle) as {
      encryptedSlots?: { slotId: string; nonce: string }[];
    };
    const fingerprint = (slots: { slotId: string; nonce: string }[]) =>
      slots.map((slot) => `${slot.slotId}:${slot.nonce}`).sort().join("|");
    return fingerprint(sessionBundle.encryptedSlots ?? []) === fingerprint(bundle.encryptedSlots)
      ? "match"
      : "mismatch";
  } catch {
    return "no-session";
  }
}

/** Typed / generic errors only. Never echo bundle plaintext or slot keys. */
export function publicHydrationError(cause: unknown): string {
  if (cause instanceof RehydrateGateError) return cause.message;
  if (cause instanceof DocumentProtocolError) return cause.code;
  if (cause instanceof Error) {
    const message = cause.message;
    if (message === "STALE_ANALYSIS_RESULT") return message;
    if (message.length > 0 && message.length <= 180 && !message.includes("\n")) return message;
  }
  return "Rehydrate failed.";
}
