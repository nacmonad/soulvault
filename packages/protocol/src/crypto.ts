/**
 * SoulVault cryptographic primitives.
 *
 * Isomorphic (Node + browser) implementations of the protocol's crypto:
 *   - AES-256-GCM sealing (backups, messages, epoch-key wrapping)
 *   - secp256k1 ECDH key agreement (epoch bundles, DMs)
 *
 * Wire-format compatibility contract — these invariants match what the
 * original node:crypto implementation produced and MUST NOT change without
 * a protocol version bump:
 *   - ECDH shared secret = the 32-byte x-coordinate of the shared point
 *     (node's ECDH.computeSecret behavior), then sha256(x) as the AES key.
 *   - GCM auth tag is 16 bytes. Epoch-bundle wraps store base64(ct || tag);
 *     backup manifests store ct and tag separately.
 *   - Ephemeral public keys serialize as uncompressed hex without 0x
 *     (node's getPublicKey('hex', 'uncompressed') behavior).
 */
import { gcm } from '@noble/ciphers/aes';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  concatBytes,
  hexToBytesFlexible,
} from './bytes.js';

export const GCM_TAG_LENGTH = 16;
export const GCM_NONCE_LENGTH = 12;
export const SECP_WRAP_ALGORITHM = 'secp256k1-ecdh-aes-256-gcm' as const;

export { randomBytes, sha256 };

export function sha256Hex(input: Uint8Array): string {
  return bytesToHex(sha256(input));
}

export type AesGcmSealed = {
  ciphertext: Uint8Array;
  tag: Uint8Array;
};

/** AES-256-GCM encrypt. Returns ciphertext and 16-byte auth tag separately. */
export function aesGcmSeal(input: {
  key: Uint8Array;
  nonce: Uint8Array;
  plaintext: Uint8Array;
  aad?: Uint8Array;
}): AesGcmSealed {
  assertKeyAndNonce(input.key, input.nonce);
  const sealed = gcm(input.key, input.nonce, input.aad).encrypt(input.plaintext);
  return {
    ciphertext: sealed.subarray(0, sealed.length - GCM_TAG_LENGTH),
    tag: sealed.subarray(sealed.length - GCM_TAG_LENGTH),
  };
}

/** AES-256-GCM decrypt. Throws on auth failure. */
export function aesGcmOpen(input: {
  key: Uint8Array;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
  aad?: Uint8Array;
}): Uint8Array {
  assertKeyAndNonce(input.key, input.nonce);
  const sealed = concatBytes(input.ciphertext, input.tag);
  return gcm(input.key, input.nonce, input.aad).decrypt(sealed);
}

function assertKeyAndNonce(key: Uint8Array, nonce: Uint8Array) {
  if (key.length !== 32) throw new Error('AES-256-GCM key must be 32 bytes');
  if (nonce.length !== GCM_NONCE_LENGTH) throw new Error(`AES-GCM nonce must be ${GCM_NONCE_LENGTH} bytes`);
}

/**
 * secp256k1 ECDH shared secret: the 32-byte x-coordinate of the shared point.
 * Matches node:crypto's ECDH.computeSecret output.
 */
export function ecdhSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  const point = secp256k1.getSharedSecret(privateKey, publicKey, false);
  return point.subarray(1, 33);
}

/** sha256 of the ECDH x-coordinate — the protocol's key-wrap AES key. */
export function deriveWrapKey(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return sha256(ecdhSharedSecret(privateKey, publicKey));
}

/** A key wrapped to a secp256k1 public key. Wire shape used in epoch bundles. */
export type SecpWrappedKey = {
  /** base64(ciphertext || 16-byte GCM tag) */
  wrappedKey: string;
  algorithm: typeof SECP_WRAP_ALGORITHM;
  /** Uncompressed hex (04 || x || y), no 0x prefix. */
  ephemeralPublicKey: string;
  /** Hex, 12 bytes. */
  nonce: string;
};

/**
 * Wrap a secret (e.g. K_epoch) to a recipient's secp256k1 public key using
 * an ephemeral ECDH keypair + AES-256-GCM.
 */
export function wrapKeyForSecp256k1PublicKey(secretHex: string, recipientPubkeyHex: string): SecpWrappedKey {
  const ephemeralPrivateKey = secp256k1.utils.randomPrivateKey();
  const ephemeralPublicKey = secp256k1.getPublicKey(ephemeralPrivateKey, false);
  const aesKey = deriveWrapKey(ephemeralPrivateKey, hexToBytesFlexible(recipientPubkeyHex));
  const nonce = randomBytes(GCM_NONCE_LENGTH);
  const { ciphertext, tag } = aesGcmSeal({
    key: aesKey,
    nonce,
    plaintext: hexToBytesFlexible(secretHex),
  });
  return {
    wrappedKey: bytesToBase64(concatBytes(ciphertext, tag)),
    algorithm: SECP_WRAP_ALGORITHM,
    ephemeralPublicKey: bytesToHex(ephemeralPublicKey),
    nonce: bytesToHex(nonce),
  };
}

/**
 * Unwrap a SecpWrappedKey with the recipient's private key.
 * Returns the secret as hex without a 0x prefix. Throws on auth failure.
 */
export function unwrapKeyWithSecp256k1PrivateKey(
  entry: Pick<SecpWrappedKey, 'wrappedKey' | 'ephemeralPublicKey' | 'nonce'>,
  privateKeyHex: string,
): string {
  const aesKey = deriveWrapKey(
    hexToBytesFlexible(privateKeyHex),
    hexToBytesFlexible(entry.ephemeralPublicKey),
  );
  const wrapped = base64ToBytes(entry.wrappedKey);
  const plaintext = aesGcmOpen({
    key: aesKey,
    nonce: hexToBytesFlexible(entry.nonce),
    ciphertext: wrapped.subarray(0, wrapped.length - GCM_TAG_LENGTH),
    tag: wrapped.subarray(wrapped.length - GCM_TAG_LENGTH),
  });
  return bytesToHex(plaintext);
}
