import { DocumentProtocolError, type PublicDocumentBundle } from "@soulvault/protocol";
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
  | { mode: "required"; appId: string; action: string }
  | { mode: "error"; message: string };

export function resolveWorldRehydrateGate(
  env: {
    appId?: string;
    gate?: string;
    nodeEnv?: string;
  } = {},
): WorldRehydrateGate {
  const appId = env.appId?.trim() ?? "";
  const gate = (env.gate ?? "").trim().toLowerCase();
  if (gate === "off") return { mode: "off" };
  if (appId) return { mode: "required", appId, action: WORLD_REHYDRATE_ACTION };
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
  const value = raw as { nullifier?: unknown; credentialId?: unknown; signal?: unknown };
  if (typeof value.nullifier !== "string" || value.nullifier.length === 0) return null;
  if (typeof value.signal !== "string" || value.signal.length === 0) return null;
  const credentialId =
    typeof value.credentialId === "number"
      ? value.credentialId
      : typeof value.credentialId === "string"
        ? Number(value.credentialId)
        : NaN;
  if (!Number.isInteger(credentialId)) return null;
  return { nullifier: value.nullifier, credentialId, signal: value.signal };
}

export function evaluateSelfieProof(input: {
  proof: unknown;
  expectedSignal: string;
  consumedNullifiers: ReadonlySet<string>;
}): { ok: true; nullifier: string } | { ok: false; reason: string } {
  const proof = parseSelfieProof(input.proof);
  if (!proof) return { ok: false, reason: "malformed-proof" };
  if (proof.credentialId !== 11) return { ok: false, reason: "wrong-credential" };
  if (proof.signal.toLowerCase() !== input.expectedSignal.toLowerCase()) {
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
