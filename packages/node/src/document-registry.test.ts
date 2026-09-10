import { describe, expect, it } from 'vitest';

import { publishTargetFromBundle } from '../src/document-registry.js';

const DOC_HASH = '0xc9cde9591206cac556c2cb83a6d58cee871cbcefe026b68b868749280f0ffe5f';

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    artifact: {
      version: 'soulvault-document-v0',
      documentId: DOC_HASH,
      format: 'text/plain',
      content: 'Patient {{sv:pii-person-rsujwu}} called.',
      slots: [
        { slotId: 'pii-person-rsujwu', entityType: 'PERSON', marker: '{{sv:pii-person-rsujwu}}', occurrences: 1 },
        { slotId: 'pii-phone-number-hv31fw', entityType: 'PHONE_NUMBER', marker: '{{sv:pii-phone-number-hv31fw}}', occurrences: 1 },
      ],
    },
    encryptedSlots: [],
  };
}

describe('publishTargetFromBundle', () => {
  it('extracts docHash and slot ids from a public bundle', () => {
    expect(publishTargetFromBundle(bundle())).toEqual({
      docHash: DOC_HASH,
      slotIds: ['pii-person-rsujwu', 'pii-phone-number-hv31fw'],
    });
  });

  it('rejects non-objects, bundles without an artifact, and malformed artifacts', () => {
    expect(() => publishTargetFromBundle(null)).toThrow(/not a JSON object/i);
    expect(() => publishTargetFromBundle('bundle')).toThrow(/not a JSON object/i);
    expect(() => publishTargetFromBundle({ encryptedSlots: [] })).toThrow(/no artifact/i);
    expect(() => publishTargetFromBundle({ artifact: {} })).toThrow(/documentId/i);
    expect(() => publishTargetFromBundle({ artifact: { documentId: '0x1234' } })).toThrow(/32-byte hash/i);
    expect(() =>
      publishTargetFromBundle({ artifact: { documentId: DOC_HASH, content: 'x' } }),
    ).toThrow(/slots is missing/i);
  });

  it('rejects bundles with no usable slots', () => {
    expect(() =>
      publishTargetFromBundle({ artifact: { documentId: DOC_HASH, content: 'x', slots: [] } }),
    ).toThrow(/no slot ids/i);
    expect(() =>
      publishTargetFromBundle({ artifact: { documentId: DOC_HASH, content: 'x', slots: [{ nope: 1 }, null] } }),
    ).toThrow(/no slot ids/i);
  });

  it('ignores empty slot entries but keeps real ones', () => {
    expect(
      publishTargetFromBundle({
        artifact: { documentId: DOC_HASH, slots: [{ slotId: '' }, { slotId: 'pii-x' }] },
      }),
    ).toEqual({ docHash: DOC_HASH, slotIds: ['pii-x'] });
  });
});
