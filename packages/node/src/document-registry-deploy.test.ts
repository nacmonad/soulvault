import { describe, expect, it } from 'vitest';

import {
  parseDocumentRegistryEntries,
  upsertDocumentRegistryEntry,
  type DocumentRegistryEnsRecord,
} from '../src/document-registry-deploy.js';

const SEPOLIA: DocumentRegistryEnsRecord = {
  chainId: 11155111,
  address: '0x315CaF1C715d87631172cF7Adf3730eed5383817',
  deployedAtBlock: 9_000_001,
  deployedAt: '2026-09-10T12:00:00.000Z',
};

const GALILEO: DocumentRegistryEnsRecord = {
  chainId: 16602,
  address: '0x8888888888888888888888888888888888888888',
  deployedAtBlock: 5_000,
};

describe('parseDocumentRegistryEntries', () => {
  it('round-trips a serialized entries array', () => {
    const parsed = parseDocumentRegistryEntries(JSON.stringify([SEPOLIA, GALILEO]));
    expect(parsed).toEqual([SEPOLIA, GALILEO]);
  });

  it('returns an empty array for empty, garbage, and wrong-shape payloads', () => {
    expect(parseDocumentRegistryEntries('')).toEqual([]);
    expect(parseDocumentRegistryEntries('   ')).toEqual([]);
    expect(parseDocumentRegistryEntries('{not json')).toEqual([]);
    // Tolerates the legacy single-object shape by yielding nothing rather than throwing.
    expect(parseDocumentRegistryEntries(JSON.stringify(SEPOLIA))).toEqual([]);
    expect(
      parseDocumentRegistryEntries(JSON.stringify([{ chainId: '11155111' }, { address: '0x1' }])),
    ).toEqual([]);
  });
});

describe('upsertDocumentRegistryEntry', () => {
  it('creates a first entry with checksummed address', () => {
    const next = upsertDocumentRegistryEntry([], {
      chainId: 11155111,
      address: '0x315caf1c715d87631172cf7adf3730eed5383817',
      deployedAtBlock: 123,
    });
    expect(next).toHaveLength(1);
    expect(next[0].address).toBe('0x315CaF1C715d87631172cF7Adf3730eed5383817');
    expect(next[0].deployedAtBlock).toBe(123);
  });

  it('upserts by chainId, inheriting prior metadata when omitted', () => {
    const next = upsertDocumentRegistryEntry([SEPOLIA], {
      chainId: 11155111,
      address: '0x9999999999999999999999999999999999999999',
    });
    expect(next).toHaveLength(1);
    expect(next[0].address).toBe('0x9999999999999999999999999999999999999999');
    expect(next[0].deployedAtBlock).toBe(9_000_001);
    expect(next[0].deployedAt).toBe('2026-09-10T12:00:00.000Z');
  });

  it('adds a second chain without touching the first (multichain parity with soulvault.treasuries)', () => {
    const next = upsertDocumentRegistryEntry([SEPOLIA], GALILEO);
    expect(next.map((e) => e.chainId)).toEqual([16602, 11155111]); // sorted ascending
    expect(next.find((e) => e.chainId === 11155111)).toEqual(SEPOLIA);
    expect(next.find((e) => e.chainId === 16602)).toEqual(GALILEO);
  });
});
