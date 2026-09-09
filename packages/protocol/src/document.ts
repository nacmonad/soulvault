import {
  aesGcmOpen,
  aesGcmSeal,
  GCM_NONCE_LENGTH,
  randomBytes,
  sha256Hex,
} from './crypto.js';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToUtf8,
  hexToBytesFlexible,
  utf8ToBytes,
} from './bytes.js';

export const DOCUMENT_PROTOCOL_VERSION = 'soulvault-document-v0' as const;
export const DOCUMENT_CIPHER_ALGORITHM = 'aes-256-gcm' as const;

export type DocumentProtocolErrorCode =
  | 'INVALID_INPUT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_ARTIFACT'
  | 'INVALID_ATTESTATION'
  | 'UNAUTHORIZED_RECIPIENT'
  | 'MISSING_SLOT'
  | 'AUTHENTICATION_FAILED';

export class DocumentProtocolError extends Error {
  readonly name = 'DocumentProtocolError';

  constructor(
    readonly code: DocumentProtocolErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export type ReviewedSensitiveSpan = {
  start: number;
  end: number;
  entityType: string;
  /** Reuse a slot id to represent repeated occurrences of the same value. */
  slotId?: string;
};

export type RedactedSlotReference = {
  slotId: string;
  entityType: string;
  marker: string;
  occurrences: number;
};

export type RedactedDocumentArtifact = {
  version: typeof DOCUMENT_PROTOCOL_VERSION;
  documentId: string;
  format: 'text/plain';
  content: string;
  slots: RedactedSlotReference[];
};

export const EXTERNAL_SLOT_PROTOCOL_VERSION = 'soulvault-external-slot-v0' as const;
export const DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES = 64 * 1024;

export type InlineDocumentSlot = {
  version: typeof DOCUMENT_PROTOCOL_VERSION;
  documentId: string;
  slotId: string;
  algorithm: typeof DOCUMENT_CIPHER_ALGORITHM;
  nonce: string;
  ciphertext: string;
  tag: string;
  /** Inline payloads ride inside the public bundle file. */
  storage?: 'inline';
};

export type ExternalSlotLocator = {
  /** Fixed kind tag; discriminates external references from inline payloads. */
  readonly kind: 'external';
  readonly protocolVersion: typeof EXTERNAL_SLOT_PROTOCOL_VERSION;
  /** Opaque store-specific address (e.g. a 0G root hash). Contains no secrets. */
  readonly locator: string;
  /** Sha256 hex of the exact bytes stored at the locator. */
  readonly contentHash: string;
  readonly byteLength: number;
};

export type LocatedDocumentSlot = {
  version: typeof DOCUMENT_PROTOCOL_VERSION;
  documentId: string;
  slotId: string;
  algorithm: typeof DOCUMENT_CIPHER_ALGORITHM;
  nonce: string;
  /** Never present on located slots; the payload lives behind `external`. */
  ciphertext?: undefined;
  tag: string;
  storage: 'located';
  /** Integrity-bound pointer; resolve it via an ExternalSlotStore before hydration. */
  external: ExternalSlotLocator;
};

/**
 * A slot payload, either inline in the bundle file or referenced through an
 * integrity-bound external locator (see docs/adr/0001-external-slot-overflow-storage.md).
 */
export type EncryptedDocumentSlot = InlineDocumentSlot | LocatedDocumentSlot;

export type ExternalSlotRecord = {
  readonly version: typeof EXTERNAL_SLOT_PROTOCOL_VERSION;
  readonly slotId: string;
  readonly algorithm: typeof DOCUMENT_CIPHER_ALGORITHM;
  readonly nonce: string;
  readonly tag: string;
  /** Base64-encoded ciphertext; lives only in external storage, never in the bundle. */
  readonly ciphertext: string;
};

/**
 * Minimal storage port for oversized slot payloads. Implementations keep the
 * protocol package isomorphic: bytes in, bytes out, no fetch, no Node built-ins.
 * `put` returns the store-assigned locator address for the stored bytes.
 */
export interface ExternalSlotStore {
  put(bytes: Uint8Array): Promise<string>;
  get(locator: string): Promise<Uint8Array>;
}

export type DocumentSlotKey = {
  slotId: string;
  /** Hex-encoded 32-byte secret. Never serialize this with the public bundle. */
  key: string;
};

export type PublicDocumentBundle = {
  artifact: RedactedDocumentArtifact;
  encryptedSlots: EncryptedDocumentSlot[];
};

export type RedactedDocumentResult = PublicDocumentBundle & {
  slotKeys: DocumentSlotKey[];
};

type RandomSource = (length: number) => Uint8Array;

export function redactAndEncryptDocument(input: {
  text: string;
  spans: ReviewedSensitiveSpan[];
  random?: RandomSource;
}): RedactedDocumentResult {
  const spans = validateAndNormalizeSpans(input.text, input.spans);
  const slotValues = new Map<string, { entityType: string; plaintext: string; occurrences: number }>();

  for (const span of spans) {
    const plaintext = input.text.slice(span.start, span.end);
    const current = slotValues.get(span.slotId);
    if (current && (current.plaintext !== plaintext || current.entityType !== span.entityType)) {
      throw new DocumentProtocolError(
        'INVALID_INPUT',
        `Repeated slot ${span.slotId} must identify the same entity type and exact value`,
      );
    }
    slotValues.set(span.slotId, {
      entityType: span.entityType,
      plaintext,
      occurrences: (current?.occurrences ?? 0) + 1,
    });
  }

  let content = input.text;
  for (const span of [...spans].sort((a, b) => b.start - a.start)) {
    content = `${content.slice(0, span.start)}${markerForSlot(span.slotId)}${content.slice(span.end)}`;
  }

  const slots = [...slotValues.entries()]
    .map(([slotId, value]) => ({
      slotId,
      entityType: value.entityType,
      marker: markerForSlot(slotId),
      occurrences: value.occurrences,
    }))
    .sort((a, b) => a.slotId.localeCompare(b.slotId));
  const documentId = computeDocumentId({ content, slots });
  const artifact: RedactedDocumentArtifact = {
    version: DOCUMENT_PROTOCOL_VERSION,
    documentId,
    format: 'text/plain',
    content,
    slots,
  };
  const random = input.random ?? randomBytes;
  const encryptedSlots: EncryptedDocumentSlot[] = [];
  const slotKeys: DocumentSlotKey[] = [];

  for (const slot of slots) {
    const value = slotValues.get(slot.slotId)!;
    const key = random(32);
    const nonce = random(GCM_NONCE_LENGTH);
    if (key.length !== 32 || nonce.length !== GCM_NONCE_LENGTH) {
      throw new DocumentProtocolError('INVALID_INPUT', 'Random source returned an invalid byte length');
    }
    const { ciphertext, tag } = aesGcmSeal({
      key,
      nonce,
      plaintext: utf8ToBytes(value.plaintext),
      aad: documentSlotAad(documentId, slot.slotId),
    });
    encryptedSlots.push({
      version: DOCUMENT_PROTOCOL_VERSION,
      documentId,
      slotId: slot.slotId,
      algorithm: DOCUMENT_CIPHER_ALGORITHM,
      nonce: bytesToHex(nonce),
      ciphertext: bytesToBase64(ciphertext),
      tag: bytesToHex(tag),
    });
    slotKeys.push({ slotId: slot.slotId, key: bytesToHex(key) });
  }

  return { artifact, encryptedSlots, slotKeys };
}

export function rehydrateDocument(input: {
  artifact: RedactedDocumentArtifact;
  encryptedSlots: EncryptedDocumentSlot[];
  slotKeys: DocumentSlotKey[];
  /** Leave unavailable markers redacted. Defaults to requiring every slot. */
  allowPartial?: boolean;
}): string {
  validateArtifact(input.artifact);
  const encryptedById = uniqueBySlot(input.encryptedSlots, 'encrypted slot');
  const keysById = uniqueBySlot(input.slotKeys, 'slot key');
  let hydrated = input.artifact.content;

  for (const reference of input.artifact.slots) {
    const encrypted = encryptedById.get(reference.slotId);
    const key = keysById.get(reference.slotId);
    if (!encrypted || !key) {
      if (input.allowPartial) continue;
      throw new DocumentProtocolError('MISSING_SLOT', `Missing encrypted data or key for ${reference.slotId}`);
    }
    validateEncryptedSlot(encrypted, input.artifact.documentId, reference.slotId);
    if (encrypted.storage === 'located') {
      // Unresolved external payload: treat exactly like an unavailable slot.
      if (input.allowPartial) continue;
      throw new DocumentProtocolError(
        'MISSING_SLOT',
        `External payload for ${reference.slotId} has not been resolved; call resolveExternalSlots first`,
      );
    }
    let plaintext: string;
    try {
      plaintext = bytesToUtf8(aesGcmOpen({
        key: hexToBytesFlexible(key.key),
        nonce: hexToBytesFlexible(encrypted.nonce),
        ciphertext: base64ToBytes(encrypted.ciphertext),
        tag: hexToBytesFlexible(encrypted.tag),
        aad: documentSlotAad(input.artifact.documentId, reference.slotId),
      }));
    } catch (cause) {
      throw new DocumentProtocolError(
        'AUTHENTICATION_FAILED',
        `Could not authenticate encrypted slot ${reference.slotId}`,
        { cause },
      );
    }
    hydrated = hydrated.split(reference.marker).join(plaintext);
  }
  return hydrated;
}

export function serializePublicDocumentBundle(bundle: PublicDocumentBundle): string {
  validateArtifact(bundle.artifact);
  for (const slot of bundle.encryptedSlots) {
    validateEncryptedSlot(slot, bundle.artifact.documentId, slot.slotId);
  }
  // Build the public shape explicitly. Callers may pass a structurally compatible
  // RedactedDocumentResult containing slotKeys; those secrets must never leak
  // through serialization as excess runtime properties.
  return JSON.stringify({
    artifact: bundle.artifact,
    encryptedSlots: bundle.encryptedSlots,
  });
}

export function parsePublicDocumentBundle(serialized: string): PublicDocumentBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'Document bundle is not valid JSON', { cause });
  }
  if (!isRecord(parsed) || !isRecord(parsed.artifact) || !Array.isArray(parsed.encryptedSlots)) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'Document bundle has an invalid shape');
  }
  const artifact = parsed.artifact as RedactedDocumentArtifact;
  const encryptedSlots = parsed.encryptedSlots as EncryptedDocumentSlot[];
  validateArtifact(artifact);
  uniqueBySlot(encryptedSlots, 'encrypted slot');
  for (const slot of encryptedSlots) validateEncryptedSlot(slot, artifact.documentId, slot.slotId);
  return { artifact, encryptedSlots };
}

export function documentSlotAad(documentId: string, slotId: string): Uint8Array {
  return utf8ToBytes(JSON.stringify({
    version: DOCUMENT_PROTOCOL_VERSION,
    documentId,
    slotId,
  }));
}

function computeDocumentId(input: { content: string; slots: RedactedSlotReference[] }): string {
  return sha256Hex(utf8ToBytes(JSON.stringify({
    version: DOCUMENT_PROTOCOL_VERSION,
    format: 'text/plain',
    content: input.content,
    slots: input.slots,
  })));
}

function markerForSlot(slotId: string): string {
  return `{{sv:${slotId}}}`;
}

function validateAndNormalizeSpans(text: string, input: ReviewedSensitiveSpan[]) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new DocumentProtocolError('INVALID_INPUT', 'At least one reviewed sensitive span is required');
  }
  const spans = input.map((span, index) => {
    const slotId = span.slotId ?? `slot-${String(index + 1).padStart(4, '0')}`;
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > text.length) {
      throw new DocumentProtocolError('INVALID_INPUT', `Span ${index} is outside the source text`);
    }
    if (!span.entityType.trim()) throw new DocumentProtocolError('INVALID_INPUT', `Span ${index} has no entity type`);
    if (!/^[A-Za-z0-9._-]+$/.test(slotId)) {
      throw new DocumentProtocolError('INVALID_INPUT', `Slot id ${slotId} contains unsupported characters`);
    }
    const marker = markerForSlot(slotId);
    if (text.includes(marker)) {
      throw new DocumentProtocolError('INVALID_INPUT', `Source text already contains reserved marker ${marker}`);
    }
    return { ...span, entityType: span.entityType.trim(), slotId };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index].start < spans[index - 1].end) {
      throw new DocumentProtocolError('INVALID_INPUT', 'Reviewed sensitive spans must not overlap');
    }
  }
  return spans;
}

function validateArtifact(artifact: RedactedDocumentArtifact): void {
  if (artifact.version !== DOCUMENT_PROTOCOL_VERSION) {
    throw new DocumentProtocolError('UNSUPPORTED_VERSION', `Unsupported document version ${String(artifact.version)}`);
  }
  if (artifact.format !== 'text/plain' || typeof artifact.content !== 'string' || !Array.isArray(artifact.slots)) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'Redacted artifact has an invalid shape');
  }
  uniqueBySlot(artifact.slots, 'slot reference');
  for (const slot of artifact.slots) {
    if (
      typeof slot.slotId !== 'string' || typeof slot.entityType !== 'string' ||
      slot.marker !== markerForSlot(slot.slotId) || !Number.isInteger(slot.occurrences) || slot.occurrences < 1
    ) {
      throw new DocumentProtocolError('INVALID_ARTIFACT', 'Redacted artifact contains an invalid slot reference');
    }
    if (artifact.content.split(slot.marker).length - 1 !== slot.occurrences) {
      throw new DocumentProtocolError('INVALID_ARTIFACT', `Marker count does not match ${slot.slotId}`);
    }
  }
  if (artifact.documentId !== computeDocumentId({ content: artifact.content, slots: artifact.slots })) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'Document identifier does not match public artifact data');
  }
}

function validateEncryptedSlot(slot: EncryptedDocumentSlot, documentId: string, slotId: string): void {
  if (slot.version !== DOCUMENT_PROTOCOL_VERSION) {
    throw new DocumentProtocolError('UNSUPPORTED_VERSION', `Unsupported encrypted slot version ${String(slot.version)}`);
  }
  const commonBinding =
    slot.documentId !== documentId || slot.slotId !== slotId ||
    slot.algorithm !== DOCUMENT_CIPHER_ALGORITHM ||
    !/^[0-9a-f]{24}$/i.test(slot.nonce) || !/^[0-9a-f]{32}$/i.test(slot.tag);
  if (commonBinding) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', `Encrypted slot ${slotId} has an invalid shape or binding`);
  }
  if (slot.storage === 'located') {
    if (
      slot.ciphertext !== undefined || !isRecord(slot.external) ||
      slot.external.kind !== 'external' ||
      slot.external.protocolVersion !== EXTERNAL_SLOT_PROTOCOL_VERSION ||
      typeof slot.external.locator !== 'string' || slot.external.locator.trim() === '' ||
      typeof slot.external.contentHash !== 'string' || !/^[0-9a-f]{64}$/i.test(slot.external.contentHash) ||
      !Number.isSafeInteger(slot.external.byteLength) || slot.external.byteLength < 1
    ) {
      throw new DocumentProtocolError('INVALID_ARTIFACT', `Located slot ${slotId} has an invalid external locator`);
    }
    return;
  }
  if (typeof slot.ciphertext !== 'string') {
    throw new DocumentProtocolError('INVALID_ARTIFACT', `Encrypted slot ${slotId} has invalid ciphertext`);
  }
  try {
    base64ToBytes(slot.ciphertext);
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', `Encrypted slot ${slotId} has invalid ciphertext`, { cause });
  }
}

function uniqueBySlot<T extends { slotId: string }>(items: T[], description: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    if (!item || typeof item.slotId !== 'string' || result.has(item.slotId)) {
      throw new DocumentProtocolError('INVALID_ARTIFACT', `Duplicate or invalid ${description}`);
    }
    result.set(item.slotId, item);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
