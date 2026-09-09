import { describe, expect, it } from 'vitest';

import {
  parseTreasuryEntriesRecord,
  upsertTreasuryEntry,
  type TreasuryEnsEntry,
} from '../src/treasury-deploy.js';

const SEPOLIA: TreasuryEnsEntry = {
  chainId: 11155111,
  address: '0x315CaF1C715d87631172cF7Adf3730eed5383817',
  createdAt: '2026-09-09T16:16:15.741Z',
};
const GALILEO: TreasuryEnsEntry = {
  chainId: 16602,
  address: '0x9999999999999999999999999999999999999999',
  createdAt: '2026-09-09T17:00:00.000Z',
};

describe('parseTreasuryEntriesRecord', () => {
  it('parses a well-formed record', () => {
    const raw = JSON.stringify([SEPOLIA, GALILEO]);
    expect(parseTreasuryEntriesRecord(raw)).toEqual([SEPOLIA, GALILEO]);
  });

  it('returns [] for empty / unset records', () => {
    expect(parseTreasuryEntriesRecord('')).toEqual([]);
    expect(parseTreasuryEntriesRecord('   ')).toEqual([]);
  });

  it('tolerates garbage — never throws', () => {
    expect(parseTreasuryEntriesRecord('not json')).toEqual([]);
    expect(parseTreasuryEntriesRecord('{"chainId":1}')).toEqual([]); // object, not array
    expect(parseTreasuryEntriesRecord('[null, 42, "x"]')).toEqual([]);
    expect(parseTreasuryEntriesRecord('[{"address":"0xabc"}]')).toEqual([]); // missing chainId
    expect(parseTreasuryEntriesRecord('[{"chainId":"1","address":"0x0"}]')).toEqual([]); // wrong types
  });

  it('keeps valid entries mixed with invalid ones', () => {
    const raw = '[{"chainId":11155111,"address":"0x315CaF1C715d87631172cF7Adf3730eed5383817"},{"bogus":true}]';
    const parsed = parseTreasuryEntriesRecord(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].chainId).toBe(11155111);
  });
});

describe('upsertTreasuryEntry', () => {
  it('appends a new chain and sorts by chainId ascending', () => {
    const next = upsertTreasuryEntry([SEPOLIA], GALILEO);
    expect(next.map((e) => e.chainId)).toEqual([16602, 11155111]);
  });

  it('replaces the entry for the same chain without clobbering other chains', () => {
    const replacement = { ...SEPOLIA, address: '0x8888888888888888888888888888888888888888' };
    const next = upsertTreasuryEntry([SEPOLIA, GALILEO], replacement);
    expect(next).toHaveLength(2);
    expect(next.find((e) => e.chainId === 11155111)?.address).toBe(replacement.address);
    expect(next.find((e) => e.chainId === 16602)).toEqual(GALILEO);
  });

  it('inherits createdAt and label from the prior entry when omitted', () => {
    const labeled: TreasuryEnsEntry = { ...SEPOLIA, label: 'ops treasury' };
    const next = upsertTreasuryEntry([labeled], {
      chainId: 11155111,
      address: SEPOLIA.address,
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    expect(next[0].label).toBe('ops treasury');
    expect(next[0].createdAt).toBe('2026-09-10T00:00:00.000Z');
  });

  it('checksums the address', () => {
    const next = upsertTreasuryEntry([], {
      chainId: 1,
      address: SEPOLIA.address.toLowerCase(),
    });
    expect(next[0].address).toBe(SEPOLIA.address);
  });
});
