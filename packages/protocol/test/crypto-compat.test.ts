/**
 * Compatibility tests proving the noble-based isomorphic crypto produces and
 * consumes the exact wire formats of the original node:crypto implementation.
 * node:crypto is used here as the reference oracle — test-only; src stays
 * free of Node built-ins.
 */
import nodeCrypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  aesGcmOpen,
  aesGcmSeal,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  ecdhSharedSecret,
  hexToBytesFlexible,
  sha256Hex,
  unwrapKeyWithSecp256k1PrivateKey,
  utf8ToBytes,
  wrapKeyForSecp256k1PublicKey,
} from '../src/index.js';

function randomHex(bytes: number) {
  return nodeCrypto.randomBytes(bytes).toString('hex');
}

describe('ECDH shared secret (node compatibility)', () => {
  it('matches node ECDH.computeSecret (x-coordinate only)', () => {
    for (let i = 0; i < 5; i++) {
      const a = nodeCrypto.createECDH('secp256k1');
      a.generateKeys();
      const b = nodeCrypto.createECDH('secp256k1');
      b.generateKeys();

      const nodeSecret = a.computeSecret(b.getPublicKey());
      const nobleSecret = ecdhSharedSecret(
        new Uint8Array(a.getPrivateKey()),
        new Uint8Array(b.getPublicKey()),
      );
      expect(bytesToHex(nobleSecret)).toBe(nodeSecret.toString('hex'));
    }
  });
});

describe('AES-256-GCM (node compatibility)', () => {
  const key = new Uint8Array(nodeCrypto.randomBytes(32));
  const nonce = new Uint8Array(nodeCrypto.randomBytes(12));
  const plaintext = utf8ToBytes('soulvault archive payload');
  const aad = utf8ToBytes(JSON.stringify({ archivePath: 'x.tar.gz', algorithm: 'aes-256-gcm-test-scaffold' }));

  it('node encrypts → noble decrypts (with AAD)', () => {
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();

    const opened = aesGcmOpen({ key, nonce, ciphertext: new Uint8Array(ciphertext), tag: new Uint8Array(tag), aad });
    expect(bytesToHex(opened)).toBe(bytesToHex(plaintext));
  });

  it('noble encrypts → node decrypts (with AAD)', () => {
    const { ciphertext, tag } = aesGcmSeal({ key, nonce, plaintext, aad });

    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(tag));
    const opened = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    expect(opened.toString('hex')).toBe(bytesToHex(plaintext));
  });

  it('rejects tampered ciphertext', () => {
    const { ciphertext, tag } = aesGcmSeal({ key, nonce, plaintext, aad });
    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 0xff;
    expect(() => aesGcmOpen({ key, nonce, ciphertext: tampered, tag, aad })).toThrow();
  });
});

describe('epoch key wrap/unwrap (legacy node implementation interop)', () => {
  /** The original cli/src/lib/epoch-bundle.ts wrap, verbatim, as reference. */
  function legacyNodeWrap(epochKeyHex: string, recipientPubkeyHex: string) {
    const ecdh = nodeCrypto.createECDH('secp256k1');
    ecdh.generateKeys();
    const sharedSecret = ecdh.computeSecret(Buffer.from(recipientPubkeyHex, 'hex'));
    const aesKey = nodeCrypto.createHash('sha256').update(sharedSecret).digest();
    const nonce = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', aesKey, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(epochKeyHex, 'hex')), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      wrappedKey: Buffer.concat([ciphertext, authTag]).toString('base64'),
      ephemeralPublicKey: ecdh.getPublicKey('hex', 'uncompressed'),
      nonce: nonce.toString('hex'),
    };
  }

  /** The original decryptBundleForCurrentMember unwrap, verbatim, as reference. */
  function legacyNodeUnwrap(
    entry: { wrappedKey: string; ephemeralPublicKey: string; nonce: string },
    privateKeyHex: string,
  ) {
    const ecdh = nodeCrypto.createECDH('secp256k1');
    ecdh.setPrivateKey(Buffer.from(privateKeyHex, 'hex'));
    const sharedSecret = ecdh.computeSecret(Buffer.from(entry.ephemeralPublicKey, 'hex'));
    const aesKey = nodeCrypto.createHash('sha256').update(sharedSecret).digest();
    const wrapped = Buffer.from(entry.wrappedKey, 'base64');
    const ciphertext = wrapped.subarray(0, wrapped.length - 16);
    const authTag = wrapped.subarray(wrapped.length - 16);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(entry.nonce, 'hex'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex');
  }

  const recipient = nodeCrypto.createECDH('secp256k1');
  recipient.generateKeys();
  const recipientPub = recipient.getPublicKey('hex', 'uncompressed');
  const recipientPriv = recipient.getPrivateKey('hex');
  const epochKeyHex = randomHex(32);

  it('legacy node wrap → noble unwrap', () => {
    const entry = legacyNodeWrap(epochKeyHex, recipientPub);
    expect(unwrapKeyWithSecp256k1PrivateKey(entry, recipientPriv)).toBe(epochKeyHex);
  });

  it('noble wrap → legacy node unwrap', () => {
    const entry = wrapKeyForSecp256k1PublicKey(epochKeyHex, recipientPub);
    expect(legacyNodeUnwrap(entry, recipientPriv)).toBe(epochKeyHex);
  });

  it('noble wrap → noble unwrap round trip, 0x-prefixed inputs accepted', () => {
    const entry = wrapKeyForSecp256k1PublicKey(`0x${epochKeyHex}`, `0x${recipientPub}`);
    expect(unwrapKeyWithSecp256k1PrivateKey(entry, `0x${recipientPriv}`)).toBe(epochKeyHex);
    expect(entry.ephemeralPublicKey.startsWith('04')).toBe(true);
    expect(entry.ephemeralPublicKey).toHaveLength(130);
    expect(entry.nonce).toHaveLength(24);
  });

  it('unwrap with wrong private key fails', () => {
    const other = nodeCrypto.createECDH('secp256k1');
    other.generateKeys();
    const entry = wrapKeyForSecp256k1PublicKey(epochKeyHex, recipientPub);
    expect(() => unwrapKeyWithSecp256k1PrivateKey(entry, other.getPrivateKey('hex'))).toThrow();
  });
});

describe('hash and encoding helpers', () => {
  it('sha256Hex matches node crypto', () => {
    const data = utf8ToBytes('fingerprint me');
    expect(sha256Hex(data)).toBe(nodeCrypto.createHash('sha256').update(data).digest('hex'));
  });

  it('base64 and hex helpers match Buffer', () => {
    const data = new Uint8Array(nodeCrypto.randomBytes(37));
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'));
    expect(bytesToHex(concatBytes(data, data))).toBe(Buffer.concat([data, data]).toString('hex'));
    expect(bytesToHex(hexToBytesFlexible(`0x${Buffer.from(data).toString('hex')}`))).toBe(
      Buffer.from(data).toString('hex'),
    );
  });
});
