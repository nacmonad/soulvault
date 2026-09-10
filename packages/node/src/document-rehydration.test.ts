import { describe, expect, it } from 'vitest';
import { sha256Hex, utf8ToBytes } from '@soulvault/protocol';

import {
  DOCUMENT_REGISTRY_REHYDRATION_ABI,
  normalizeBundleInput,
  parseSlotKeyPair,
} from '../src/document-rehydration.js';

const DOC_HASH = '0xc9cde9591206cac556c2cb83a6d58cee871cbcefe026b68b868749280f0ffe5f';
const PUBKEY = '0x046569a24a9cee3dfe4f9fccfd455e9468adb5920101273da1474beea516819a1b5831e99934991b3179bc4e42bc711b43de9f06ccda71dd3d514df39068837efc';

function bundle() {
  const content = 'Patient {{sv:pii-person-rsujwu}} called from {{sv:pii-phone-number-hv31fw}}.';
  const slots = [
    { slotId: 'pii-person-rsujwu', entityType: 'PERSON', marker: '{{sv:pii-person-rsujwu}}', occurrences: 1 },
    { slotId: 'pii-phone-number-hv31fw', entityType: 'PHONE_NUMBER', marker: '{{sv:pii-phone-number-hv31fw}}', occurrences: 1 },
  ];
  // documentId must match the protocol's integrity binding: sha256 over the
  // canonical JSON of {version, format, content, slots}.
  const documentId = sha256Hex(utf8ToBytes(JSON.stringify({
    version: 'soulvault-document-v0',
    format: 'text/plain',
    content,
    slots,
  })));
  return {
    artifact: {
      version: 'soulvault-document-v0',
      documentId,
      format: 'text/plain',
      content,
      slots,
    },
    encryptedSlots: [
      {
        version: 'soulvault-document-v0',
        documentId,
        slotId: 'pii-person-rsujwu',
        algorithm: 'aes-256-gcm',
        nonce: 'aa'.repeat(12),
        ciphertext: 'AAAA',
        tag: 'bb'.repeat(16),
      },
    ],
    registry: { chainId: 11155111, address: '0xe4a1671E3575c90704a7fFC4C2807CCa43B3C77D' },
  };
}

describe('parseSlotKeyPair', () => {
  it('splits slotId=key pairs', () => {
    expect(parseSlotKeyPair('pii-email-address-1jtoanl=abcd1234')).toEqual({
      slotId: 'pii-email-address-1jtoanl',
      key: 'abcd1234',
    });
  });

  it('rejects pairs without = or empty sides', () => {
    expect(() => parseSlotKeyPair('noequals')).toThrow(/slotId=hex/i);
    expect(() => parseSlotKeyPair('=abcd')).toThrow(/slotId=hex/i);
    expect(() => parseSlotKeyPair('slot=')).toThrow(/slotId=hex/i);
  });
});

describe('normalizeBundleInput', () => {
  it('parses a serialized public bundle', () => {
    const raw = bundle();
    const parsed = normalizeBundleInput(JSON.stringify(raw));
    expect(parsed.artifact.documentId).toBe(raw.artifact.documentId);
    expect(parsed.encryptedSlots).toHaveLength(1);
  });

  it('passes through an already-parsed bundle', () => {
    const raw = bundle();
    expect(normalizeBundleInput(raw)).toBe(raw);
  });

  it('rejects non-bundle JSON', () => {
    expect(() => normalizeBundleInput('{"nope": 1}')).toThrow(/invalid shape/i);
  });
});

describe('DOCUMENT_REGISTRY_REHYDRATION_ABI', () => {
  it('exposes the grant and request entry points the CLI drives', () => {
    const abi = DOCUMENT_REGISTRY_REHYDRATION_ABI as readonly string[];
    expect(abi.some((fragment) => fragment.startsWith('function grantSlotKey('))).toBe(true);
    expect(abi.some((fragment) => fragment.startsWith('function requestRehydration('))).toBe(true);
    expect(abi.some((fragment) => fragment.startsWith('event RehydrationRequested('))).toBe(true);
    expect(abi.some((fragment) => fragment.startsWith('event SlotKeyGranted('))).toBe(true);
  });
});
