import { describe, expect, it } from 'vitest';
import {
  coinTypeForChain,
  decodeCborDataUri,
  decodeStringArrayCbor,
  encodeCborDataUri,
  encodeStringArrayCbor,
} from './ens.js';

/**
 * Pure unit tests for the ENS lib helpers that do not touch the network.
 *
 * The CBOR encoder is narrow on purpose (major type 4 + major type 3 only), so the test
 * surface is: roundtrip equivalence across the length-encoding boundaries defined in
 * RFC 8949 §3, plus a few coinType sanity checks for ENSIP-11.
 */

describe('coinTypeForChain (ENSIP-11)', () => {
  it('derives 0G Galileo coinType', () => {
    // ENSIP-11: coinType = (0x80000000 | chainId), unsigned. JS `|` returns a signed
    // 32-bit int so we `>>> 0` to compare against the unsigned space the impl uses.
    expect(coinTypeForChain(16602)).toBe((0x80000000 | 16602) >>> 0);
  });

  it('derives Sepolia coinType', () => {
    expect(coinTypeForChain(11155111)).toBe((0x80000000 | 11155111) >>> 0);
  });

  it('returns a positive integer for all tested chainIds', () => {
    for (const chainId of [1, 8453, 11155111, 16602, 42161]) {
      const ct = coinTypeForChain(chainId);
      expect(ct).toBeGreaterThan(0);
      expect(Number.isInteger(ct)).toBe(true);
    }
  });
});

describe('hand-rolled CBOR string-array encoder', () => {
  const roundtrip = (input: string[]) => {
    const encoded = encodeStringArrayCbor(input);
    const decoded = decodeStringArrayCbor(encoded);
    expect(decoded).toEqual(input);
  };

  it('roundtrips an empty array', () => {
    roundtrip([]);
  });

  it('roundtrips a single short string', () => {
    roundtrip(['alpha']);
  });

  it('roundtrips at the 23→24 array-length boundary (inline vs 1-byte length)', () => {
    // CBOR major type 4: additional info 0..23 is inline, 24 triggers 1-byte length.
    const at23 = Array.from({ length: 23 }, (_, i) => `swarm-${i}`);
    const at24 = Array.from({ length: 24 }, (_, i) => `swarm-${i}`);
    roundtrip(at23);
    roundtrip(at24);
  });

  it('roundtrips at the 256-element array-length boundary (1-byte → 2-byte length)', () => {
    const big = Array.from({ length: 256 }, (_, i) => `s${i}`);
    roundtrip(big);
  });

  it('roundtrips strings of length 0, 23, and 24 (string-length encoding boundary)', () => {
    roundtrip(['']);
    roundtrip(['x'.repeat(23)]);
    roundtrip(['x'.repeat(24)]);
    roundtrip(['', 'x'.repeat(23), 'x'.repeat(24), 'y'.repeat(100)]);
  });

  it('roundtrips non-ASCII UTF-8 labels', () => {
    // Emoji + BMP + supplementary plane to cover multi-byte sequences.
    roundtrip(['αβγ', '日本語', '🌀swarm', 'mixed-αβ-🔥']);
  });

  it('decoder rejects truncated input', () => {
    const good = encodeStringArrayCbor(['alpha', 'beta']);
    const truncated = good.slice(0, good.length - 1);
    expect(() => decodeStringArrayCbor(truncated)).toThrow();
  });

  it('decoder rejects wrong major type at top level', () => {
    // 0x00 = unsigned int 0 (major type 0, additional info 0) — not an array.
    expect(() => decodeStringArrayCbor(new Uint8Array([0x00]))).toThrow(/major type mismatch/);
  });
});

describe('CBOR data URI wrapping', () => {
  it('roundtrips CBOR bytes through the data URI format', () => {
    const input = ['alpha', 'beta', 'gamma'];
    const cbor = encodeStringArrayCbor(input);
    const uri = encodeCborDataUri(cbor);
    expect(uri.startsWith('data:application/cbor;base64,')).toBe(true);

    const decoded = decodeCborDataUri(uri);
    expect(decoded).toEqual(cbor);
    expect(decodeStringArrayCbor(decoded!)).toEqual(input);
  });

  it('returns null for missing or non-matching input', () => {
    expect(decodeCborDataUri('')).toBeNull();
    expect(decodeCborDataUri('plain text')).toBeNull();
    expect(decodeCborDataUri('data:application/json;base64,abc')).toBeNull();
  });
});
