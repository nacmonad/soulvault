import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES,
  EXTERNAL_SLOT_PROTOCOL_VERSION,
  MemoryExternalSlotStore,
  externalSlotRecordBytes,
  externalizeSlots,
  isExternallyLocated,
  parseExternalSlotRecord,
  parsePublicDocumentBundle,
  redactAndEncryptDocument,
  rehydrateDocument,
  resolveExternalSlots,
  serializePublicDocumentBundle,
  sha256Hex,
  shouldUseExternalStorage,
  type EncryptedDocumentSlot,
  type ExternalSlotRecord,
  type LocatedDocumentSlot,
  type PublicDocumentBundle,
} from '../src/index.js';

const source = 'Patient TEST PERSON called 555-0100. TEST PERSON confirmed 555-0100.';
const spans = [
  { start: 8, end: 19, entityType: 'PERSON', slotId: 'person-1' },
  { start: 27, end: 35, entityType: 'PHONE_NUMBER', slotId: 'phone-1' },
  { start: 37, end: 48, entityType: 'PERSON', slotId: 'person-1' },
  { start: 59, end: 67, entityType: 'PHONE_NUMBER', slotId: 'phone-1' },
];

function makeRecord(overrides: Partial<ExternalSlotRecord>): ExternalSlotRecord {
  return {
    version: EXTERNAL_SLOT_PROTOCOL_VERSION,
    slotId: 'slot-x',
    algorithm: 'aes-256-gcm',
    nonce: 'aa'.repeat(12),
    tag: 'bb'.repeat(16),
    ciphertext: 'AA==',
    ...overrides,
  };
}

async function locatedBundle(thresholdBytes = 1) {
  const redacted = redactAndEncryptDocument({ text: source, spans });
  const store = new MemoryExternalSlotStore();
  const { bundle, externalized } = await externalizeSlots({
    bundle: { artifact: redacted.artifact, encryptedSlots: redacted.encryptedSlots },
    store,
    thresholdBytes,
  });
  return { redacted, store, bundle, externalized };
}

function firstLocated(bundle: PublicDocumentBundle): LocatedDocumentSlot {
  const slot = bundle.encryptedSlots.find(isExternallyLocated);
  if (!slot || slot.storage !== 'located') throw new Error('no located slot in fixture');
  return slot;
}

function withReboundLocator(
  bundle: PublicDocumentBundle,
  slotId: string,
  overrides: Partial<LocatedDocumentSlot['external']>,
): PublicDocumentBundle {
  return {
    ...bundle,
    encryptedSlots: bundle.encryptedSlots.map((slot): EncryptedDocumentSlot => {
      if (slot.storage !== 'located' || slot.slotId !== slotId) return slot;
      return { ...slot, external: { ...slot.external, ...overrides } };
    }),
  };
}

describe('external slot placement policy', () => {
  it('is deterministic and depends only on public sealed byte length', () => {
    expect(shouldUseExternalStorage({ sealedByteLength: 100 }).useExternal).toBe(false);
    expect(
      shouldUseExternalStorage({ sealedByteLength: DEFAULT_EXTERNAL_SLOT_THRESHOLD_BYTES + 1 }).useExternal,
    ).toBe(true);
    expect(shouldUseExternalStorage({ sealedByteLength: 100, thresholdBytes: 99 }).useExternal).toBe(true);
    expect(() => shouldUseExternalStorage({ sealedByteLength: -1 })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
    expect(() => shouldUseExternalStorage({ sealedByteLength: 10, thresholdBytes: 0 })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  });
});

describe('externalize and resolve round trip', () => {
  it('moves oversized payloads out of the bundle file and hydrates identically after resolution', async () => {
    const { redacted, store, bundle, externalized } = await locatedBundle();
    expect(externalized.map((item) => item.slotId).sort()).toEqual(['person-1', 'phone-1']);

    const serialized = serializePublicDocumentBundle(bundle);
    expect(serialized).not.toContain('"ciphertext":"');
    const parsed = parsePublicDocumentBundle(serialized);
    expect(parsed.encryptedSlots.every(isExternallyLocated)).toBe(true);

    // Unresolved located slots fail closed like any unavailable slot.
    expect(() => rehydrateDocument({ ...parsed, slotKeys: redacted.slotKeys })).toThrow(
      expect.objectContaining({ code: 'MISSING_SLOT' }),
    );

    const { bundle: resolved } = await resolveExternalSlots(parsed, store);
    expect(rehydrateDocument({ ...resolved, slotKeys: redacted.slotKeys })).toBe(source);
  });

  it('keeps partial hydration marker-preserving for unresolved external slots', async () => {
    const { redacted, bundle } = await locatedBundle();
    expect(
      rehydrateDocument({
        artifact: bundle.artifact,
        encryptedSlots: bundle.encryptedSlots,
        slotKeys: redacted.slotKeys,
        allowPartial: true,
      }),
    ).toBe('Patient {{sv:person-1}} called {{sv:phone-1}}. {{sv:person-1}} confirmed {{sv:phone-1}}.');
  });

  it('leaves inline slots untouched when below threshold', async () => {
    const redacted = redactAndEncryptDocument({ text: source, spans });
    const store = new MemoryExternalSlotStore();
    const { bundle, externalized } = await externalizeSlots({
      bundle: { artifact: redacted.artifact, encryptedSlots: redacted.encryptedSlots },
      store,
    });
    expect(externalized).toEqual([]);
    expect(bundle.encryptedSlots.every((slot) => !isExternallyLocated(slot))).toBe(true);
    expect(rehydrateDocument({ ...bundle, slotKeys: redacted.slotKeys })).toBe(source);
  });

  it('honors an explicit placement override without inspecting plaintext', async () => {
    const redacted = redactAndEncryptDocument({ text: source, spans });
    const store = new MemoryExternalSlotStore();
    const { bundle, externalized } = await externalizeSlots({
      bundle: { artifact: redacted.artifact, encryptedSlots: redacted.encryptedSlots },
      store,
      thresholdBytes: Number.MAX_SAFE_INTEGER,
      placement: ({ slotId }) => slotId === 'person-1',
    });
    expect(externalized.map((item) => item.slotId)).toEqual(['person-1']);
    const { bundle: resolved } = await resolveExternalSlots(bundle, store);
    expect(rehydrateDocument({ ...resolved, slotKeys: redacted.slotKeys })).toBe(source);
  });
});

describe('fail-closed external payload verification', () => {
  it('rejects a missing payload with MISSING_SLOT', async () => {
    const { bundle } = await locatedBundle();
    const parsed = parsePublicDocumentBundle(serializePublicDocumentBundle(bundle));
    await expect(resolveExternalSlots(parsed, new MemoryExternalSlotStore())).rejects.toThrow(
      expect.objectContaining({ code: 'MISSING_SLOT' }),
    );
  });

  it('rejects a truncated payload whose claimed byte length no longer matches', async () => {
    const { store, bundle } = await locatedBundle();
    const parsed = parsePublicDocumentBundle(serializePublicDocumentBundle(bundle));
    const located = firstLocated(parsed);
    const original = await store.get(located.external.locator);
    const truncatedBytes = original.subarray(0, original.byteLength - 4);
    const truncatedStore = new MemoryExternalSlotStore();
    const locator = await truncatedStore.put(truncatedBytes);
    // The bundle still claims the original byte length; the store returns the
    // truncated bytes. Length binding must fail before parsing.
    const rebound = withReboundLocator(parsed, located.slotId, {
      locator,
      contentHash: sha256Hex(truncatedBytes),
      byteLength: original.byteLength,
    });
    await expect(resolveExternalSlots(rebound, truncatedStore)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );
  });

  it('rejects a wrong content hash with AUTHENTICATION_FAILED', async () => {
    const { store, bundle } = await locatedBundle();
    const parsed = parsePublicDocumentBundle(serializePublicDocumentBundle(bundle));
    const located = firstLocated(parsed);
    const tampered = withReboundLocator(parsed, located.slotId, {
      contentHash: 'ff'.repeat(32),
    });
    await expect(resolveExternalSlots(tampered, store)).rejects.toThrow(
      expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }),
    );
  });

  it('rejects a substituted payload from a different slot with INVALID_ARTIFACT', async () => {
    const { bundle } = await locatedBundle();
    const parsed = parsePublicDocumentBundle(serializePublicDocumentBundle(bundle));
    const located = firstLocated(parsed);
    // A well-formed record bound to a different slot id, stored at a fresh
    // locator with matching hash/length bindings — the slot binding check
    // is what must reject it.
    const otherBytes = externalSlotRecordBytes(makeRecord({ slotId: 'someone-else' }));
    const otherStore = new MemoryExternalSlotStore();
    const otherLocator = await otherStore.put(otherBytes);
    const substituted = withReboundLocator(parsed, located.slotId, {
      locator: otherLocator,
      contentHash: sha256Hex(otherBytes),
      byteLength: otherBytes.byteLength,
    });
    await expect(resolveExternalSlots(substituted, otherStore)).rejects.toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );
  });

  it('rejects a wrong-version external record with UNSUPPORTED_VERSION', async () => {
    const { bundle } = await locatedBundle();
    const parsed = parsePublicDocumentBundle(serializePublicDocumentBundle(bundle));
    const located = firstLocated(parsed);
    const wrongVersionBytes = externalSlotRecordBytes(makeRecord({
      slotId: located.slotId,
      version: 'soulvault-external-slot-v9' as never,
    }));
    const store = new MemoryExternalSlotStore();
    const locator = await store.put(wrongVersionBytes);
    const rebound = withReboundLocator(parsed, located.slotId, {
      locator,
      contentHash: sha256Hex(wrongVersionBytes),
      byteLength: wrongVersionBytes.byteLength,
    });
    await expect(resolveExternalSlots(rebound, store)).rejects.toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );
  });
});

describe('external slot record parsing', () => {
  it('round-trips records and rejects malformed stored envelopes', () => {
    const record = makeRecord({});
    expect(parseExternalSlotRecord(JSON.stringify(record))).toEqual(record);
    expect(() => parseExternalSlotRecord('not json')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );
    expect(() => parseExternalSlotRecord(JSON.stringify({ ...record, version: 'v9' }))).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );
    expect(() => parseExternalSlotRecord(JSON.stringify({ ...record, ciphertext: 5 }))).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );
  });
});
