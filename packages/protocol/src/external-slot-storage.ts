import { sha256Hex, GCM_TAG_LENGTH } from './crypto.js';
import { base64ToBytes, bytesToUtf8, utf8ToBytes } from './bytes.js';
import {
  DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES,
  EXTERNAL_SLOT_PROTOCOL_VERSION,
  DOCUMENT_CIPHER_ALGORITHM,
  DOCUMENT_PROTOCOL_VERSION,
  DocumentProtocolError,
  type ExternalSlotLocator,
  type ExternalSlotRecord,
  type ExternalSlotStore,
  type InlineDocumentSlot,
  type LocatedDocumentSlot,
  type PublicDocumentBundle,
} from './document.js';

export {
  DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES,
  EXTERNAL_SLOT_PROTOCOL_VERSION,
} from './document.js';

export type ExternalStorageDecision = {
  readonly useExternal: boolean;
  readonly sealedByteLength: number;
  readonly thresholdBytes: number;
};

/**
 * Deterministic placement policy: external storage exactly when the sealed
 * payload exceeds the threshold. Depends only on already-public ciphertext
 * byte length — never on secret plaintext content.
 */
export function shouldUseExternalStorage(input: {
  sealedByteLength: number;
  thresholdBytes?: number;
}): ExternalStorageDecision {
  const thresholdBytes = input.thresholdBytes ?? DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES;
  if (!Number.isSafeInteger(input.sealedByteLength) || input.sealedByteLength < 0) {
    throw new DocumentProtocolError('INVALID_INPUT', 'Sealed byte length must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(thresholdBytes) || thresholdBytes < 1) {
    throw new DocumentProtocolError('INVALID_INPUT', 'Threshold must be a positive safe integer');
  }
  return {
    useExternal: input.sealedByteLength > thresholdBytes,
    sealedByteLength: input.sealedByteLength,
    thresholdBytes,
  };
}

export function serializeExternalSlotRecord(record: ExternalSlotRecord): string {
  return JSON.stringify({
    version: record.version,
    slotId: record.slotId,
    algorithm: record.algorithm,
    nonce: record.nonce,
    tag: record.tag,
    ciphertext: record.ciphertext,
  });
}

export function parseExternalSlotRecord(serialized: string): ExternalSlotRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'External slot record is not valid JSON', { cause });
  }
  if (!isRecord(parsed)) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'External slot record has an invalid shape');
  }
  if (parsed.version !== EXTERNAL_SLOT_PROTOCOL_VERSION) {
    throw new DocumentProtocolError(
      'UNSUPPORTED_VERSION',
      `Unsupported external slot version ${String(parsed.version)}`,
    );
  }
  if (
    typeof parsed.slotId !== 'string' || !parsed.slotId ||
    parsed.algorithm !== DOCUMENT_CIPHER_ALGORITHM ||
    typeof parsed.nonce !== 'string' || !/^[0-9a-f]{24}$/i.test(parsed.nonce) ||
    typeof parsed.tag !== 'string' || !/^[0-9a-f]{32}$/i.test(parsed.tag) ||
    typeof parsed.ciphertext !== 'string'
  ) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'External slot record has an invalid shape or binding');
  }
  try {
    base64ToBytes(parsed.ciphertext);
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_ARTIFACT', 'External slot record has invalid ciphertext', { cause });
  }
  return {
    version: EXTERNAL_SLOT_PROTOCOL_VERSION,
    slotId: parsed.slotId,
    algorithm: parsed.algorithm,
    nonce: parsed.nonce,
    tag: parsed.tag,
    ciphertext: parsed.ciphertext,
  };
}

export function externalSlotRecordBytes(record: ExternalSlotRecord): Uint8Array {
  return utf8ToBytes(serializeExternalSlotRecord(record));
}

export type ExternalizedSlot = {
  slotId: string;
  locator: string;
  contentHash: string;
  byteLength: number;
};

/** In-memory ExternalSlotStore proving the abstraction without network credentials. */
export class MemoryExternalSlotStore implements ExternalSlotStore {
  readonly #values = new Map<string, Uint8Array>();
  #counter = 0;

  async put(bytes: Uint8Array): Promise<string> {
    this.#counter += 1;
    const locator = `mem://${sha256Hex(bytes).slice(0, 16)}-${this.#counter}`;
    this.#values.set(locator, bytes.slice());
    return locator;
  }

  async get(locator: string): Promise<Uint8Array> {
    const value = this.#values.get(locator);
    if (value === undefined) {
      throw new DocumentProtocolError(
        'MISSING_SLOT',
        `External slot payload is not available at locator ${locator}`,
      );
    }
    return value.slice();
  }
}

export type ExternalizeSlotsResult = {
  bundle: PublicDocumentBundle;
  externalized: ExternalizedSlot[];
};

/**
 * Move inline slot payloads over the placement threshold into the external
 * store, replacing them in the bundle with integrity-bound locators. One
 * record per slot is stored as versioned JSON bytes; the store assigns the
 * locator address at put() time and the bundle binds its content hash and
 * byte length, so tampering or substitution fails before hydration.
 *
 * Purely additive: inline slots below the policy (or all of them, if the store
 * is omitted) pass through unchanged, and grant semantics never change.
 */
export async function externalizeSlots(input: {
  bundle: PublicDocumentBundle;
  store?: ExternalSlotStore;
  thresholdBytes?: number;
  /**
   * Optional policy override, evaluated per slot. Return `useExternal: true`
   * to force a slot into external storage. Defaults to shouldUseExternalStorage.
   * Policy sees only public sizes and ids — never plaintext.
   */
  placement?: (decision: { slotId: string; sealedByteLength: number; thresholdBytes: number }) => boolean;
}): Promise<ExternalizeSlotsResult> {
  const { bundle, store, thresholdBytes, placement } = input;
  if (!store) {
    return { bundle, externalized: [] };
  }
  const encryptedSlots: PublicDocumentBundle['encryptedSlots'] = [];
  const externalized: ExternalizedSlot[] = [];

  for (const slot of bundle.encryptedSlots) {
    if (slot.storage === 'located') {
      encryptedSlots.push(slot);
      continue;
    }
    const inline = slot as InlineDocumentSlot;
    const sealedByteLength = base64ToBytes(inline.ciphertext).byteLength + GCM_TAG_LENGTH;
    const effectiveThreshold = thresholdBytes ?? DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES;
    const useExternal = placement
      ? placement({ slotId: inline.slotId, sealedByteLength, thresholdBytes: effectiveThreshold })
      : shouldUseExternalStorage({ sealedByteLength, thresholdBytes: effectiveThreshold }).useExternal;
    if (!useExternal) {
      encryptedSlots.push(inline);
      continue;
    }

    const record: ExternalSlotRecord = {
      version: EXTERNAL_SLOT_PROTOCOL_VERSION,
      slotId: inline.slotId,
      algorithm: inline.algorithm,
      nonce: inline.nonce,
      tag: inline.tag,
      ciphertext: inline.ciphertext,
    };
    const bytes = externalSlotRecordBytes(record);
    const locator = await store.put(bytes);
    if (typeof locator !== 'string' || locator.trim() === '') {
      throw new DocumentProtocolError('INVALID_INPUT', 'External store returned an empty locator');
    }
    encryptedSlots.push({
      version: DOCUMENT_PROTOCOL_VERSION,
      documentId: inline.documentId,
      slotId: inline.slotId,
      algorithm: inline.algorithm,
      nonce: inline.nonce,
      tag: inline.tag,
      storage: 'located',
      external: {
        kind: 'external',
        protocolVersion: EXTERNAL_SLOT_PROTOCOL_VERSION,
        locator,
        contentHash: sha256Hex(bytes),
        byteLength: bytes.byteLength,
      },
    });
    externalized.push({
      slotId: inline.slotId,
      locator,
      contentHash: sha256Hex(bytes),
      byteLength: bytes.byteLength,
    });
  }

  return { bundle: { artifact: bundle.artifact, encryptedSlots }, externalized };
}

export type ResolvedExternalSlotsResult = {
  bundle: PublicDocumentBundle;
  resolvedSlotIds: string[];
};

/**
 * Fetch and integrity-verify every externally located payload, producing a
 * bundle with fully inline ciphertext. Records are verified (byte length,
 * content hash, version, slot binding) before any caller can attempt
 * decryption, so tampering or substitution fails closed with typed errors.
 */
export async function resolveExternalSlots(
  bundle: PublicDocumentBundle,
  store: ExternalSlotStore,
): Promise<ResolvedExternalSlotsResult> {
  const encryptedSlots: PublicDocumentBundle['encryptedSlots'] = [];
  const resolvedSlotIds: string[] = [];

  for (const slot of bundle.encryptedSlots) {
    if (slot.storage !== 'located') {
      encryptedSlots.push(slot);
      continue;
    }
    encryptedSlots.push(await resolveLocatedSlot(slot, store));
    resolvedSlotIds.push(slot.slotId);
  }

  return { bundle: { artifact: bundle.artifact, encryptedSlots }, resolvedSlotIds };
}

export function isExternallyLocated(slot: PublicDocumentBundle['encryptedSlots'][number]): boolean {
  return slot.storage === 'located';
}

async function resolveLocatedSlot(
  slot: LocatedDocumentSlot,
  store: ExternalSlotStore,
): Promise<InlineDocumentSlot> {
  const external = slot.external;
  if (!external || external.kind !== 'external') {
    throw new DocumentProtocolError('INVALID_ARTIFACT', `Located slot ${slot.slotId} has no external locator`);
  }

  let bytes: Uint8Array;
  try {
    bytes = await store.get(external.locator);
  } catch (cause) {
    if (cause instanceof DocumentProtocolError) throw cause;
    throw new DocumentProtocolError(
      'MISSING_SLOT',
      `External slot payload for ${slot.slotId} could not be fetched`,
      { cause },
    );
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new DocumentProtocolError('MISSING_SLOT', `External slot payload for ${slot.slotId} is missing or empty`);
  }
  if (bytes.byteLength !== external.byteLength) {
    throw new DocumentProtocolError(
      'INVALID_ARTIFACT',
      `External slot payload for ${slot.slotId} has an unexpected byte length`,
    );
  }
  if (sha256Hex(bytes) !== external.contentHash.toLowerCase()) {
    throw new DocumentProtocolError(
      'AUTHENTICATION_FAILED',
      `External slot payload for ${slot.slotId} failed integrity verification`,
    );
  }

  const record = parseExternalSlotRecord(bytesToUtf8(bytes));
  if (record.slotId !== slot.slotId) {
    throw new DocumentProtocolError(
      'INVALID_ARTIFACT',
      `External slot record for ${slot.slotId} is bound to a different slot`,
    );
  }
  if (record.nonce !== slot.nonce || record.tag !== slot.tag) {
    throw new DocumentProtocolError(
      'INVALID_ARTIFACT',
      `External slot record for ${slot.slotId} does not match the bundle slot`,
    );
  }

  return {
    version: DOCUMENT_PROTOCOL_VERSION,
    documentId: slot.documentId,
    slotId: slot.slotId,
    algorithm: DOCUMENT_CIPHER_ALGORITHM,
    nonce: record.nonce,
    ciphertext: record.ciphertext,
    tag: record.tag,
    storage: 'inline',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
