import nodeCrypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_PROTOCOL_VERSION,
  base64ToBytes,
  documentSlotAad,
  hexToBytesFlexible,
  parsePublicDocumentBundle,
  redactAndEncryptDocument,
  rehydrateDocument,
  serializePublicDocumentBundle,
  type RedactedDocumentArtifact,
} from '../src/index.js';

const source = 'Patient TEST PERSON called 555-0100. TEST PERSON confirmed 555-0100.';
const spans = [
  { start: 8, end: 19, entityType: 'PERSON', slotId: 'person-1' },
  { start: 27, end: 35, entityType: 'PHONE_NUMBER', slotId: 'phone-1' },
  { start: 37, end: 48, entityType: 'PERSON', slotId: 'person-1' },
  { start: 59, end: 67, entityType: 'PHONE_NUMBER', slotId: 'phone-1' },
];

function deterministicRandom() {
  let value = 1;
  return (length: number) => new Uint8Array(length).fill(value++);
}

describe('structured-text document redaction and rehydration', () => {
  it('round-trips repeated sensitive values without publishing plaintext or keys', () => {
    const result = redactAndEncryptDocument({ text: source, spans, random: deterministicRandom() });

    expect(result.artifact.content).toBe(
      'Patient {{sv:person-1}} called {{sv:phone-1}}. {{sv:person-1}} confirmed {{sv:phone-1}}.',
    );
    expect(result.artifact.slots).toEqual([
      { slotId: 'person-1', entityType: 'PERSON', marker: '{{sv:person-1}}', occurrences: 2 },
      { slotId: 'phone-1', entityType: 'PHONE_NUMBER', marker: '{{sv:phone-1}}', occurrences: 2 },
    ]);
    const publicJson = serializePublicDocumentBundle(result);
    expect(publicJson).not.toContain('TEST PERSON');
    expect(publicJson).not.toContain('555-0100');
    for (const secret of result.slotKeys) expect(publicJson).not.toContain(secret.key);

    const parsed = parsePublicDocumentBundle(publicJson);
    expect(rehydrateDocument({ ...parsed, slotKeys: result.slotKeys })).toBe(source);
  });

  it('allows partial hydration while preserving unavailable markers', () => {
    const result = redactAndEncryptDocument({ text: source, spans });
    expect(rehydrateDocument({
      artifact: result.artifact,
      encryptedSlots: result.encryptedSlots,
      slotKeys: [result.slotKeys[0]],
      allowPartial: true,
    })).toBe('Patient TEST PERSON called {{sv:phone-1}}. TEST PERSON confirmed {{sv:phone-1}}.');
  });

  it('fails with typed errors for missing slots and authenticated-data tampering', () => {
    const result = redactAndEncryptDocument({ text: source, spans });
    expect(() => rehydrateDocument({ ...result, slotKeys: [] })).toThrow(
      expect.objectContaining({ code: 'MISSING_SLOT' }),
    );

    const tampered = structuredClone(result.artifact);
    tampered.documentId = '00'.repeat(32);
    expect(() => rehydrateDocument({ ...result, artifact: tampered })).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );

    const wrongKey = structuredClone(result.slotKeys);
    wrongKey[0].key = 'ff'.repeat(32);
    expect(() => rehydrateDocument({ ...result, slotKeys: wrongKey })).toThrow(
      expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }),
    );
  });

  it('rejects malformed, overlapping, conflicting repeated, and reserved-marker input', () => {
    expect(() => redactAndEncryptDocument({ text: 'abcdef', spans: [
      { start: 0, end: 3, entityType: 'A' },
      { start: 2, end: 4, entityType: 'B' },
    ] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => redactAndEncryptDocument({ text: 'one two', spans: [
      { start: 0, end: 3, entityType: 'WORD', slotId: 'same' },
      { start: 4, end: 7, entityType: 'WORD', slotId: 'same' },
    ] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => redactAndEncryptDocument({ text: '{{sv:x}} secret', spans: [
      { start: 9, end: 15, entityType: 'WORD', slotId: 'x' },
    ] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });

  it('rejects unsupported versions and malformed serialization', () => {
    expect(() => parsePublicDocumentBundle('not json')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARTIFACT' }),
    );
    const result = redactAndEncryptDocument({ text: source, spans });
    const artifact = { ...result.artifact, version: 'future-version' } as unknown as RedactedDocumentArtifact;
    expect(() => rehydrateDocument({ ...result, artifact })).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_VERSION' }),
    );
  });

  it('produces ciphertext that Node can authenticate and decrypt with the canonical AAD', () => {
    const result = redactAndEncryptDocument({ text: source, spans, random: deterministicRandom() });
    const encrypted = result.encryptedSlots[0];
    const key = result.slotKeys.find((item) => item.slotId === encrypted.slotId)!;
    const decipher = nodeCrypto.createDecipheriv(
      'aes-256-gcm',
      hexToBytesFlexible(key.key),
      hexToBytesFlexible(encrypted.nonce),
    );
    decipher.setAAD(documentSlotAad(encrypted.documentId, encrypted.slotId));
    decipher.setAuthTag(hexToBytesFlexible(encrypted.tag));
    const plaintext = Buffer.concat([
      decipher.update(base64ToBytes(encrypted.ciphertext)),
      decipher.final(),
    ]).toString('utf8');
    expect(plaintext).toBe('TEST PERSON');
    expect(encrypted.version).toBe(DOCUMENT_PROTOCOL_VERSION);
  });
});
