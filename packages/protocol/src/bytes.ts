import { base64 } from '@scure/base';
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils';

export { bytesToHex, concatBytes };

/** Decode hex with or without a 0x prefix. */
export function hexToBytesFlexible(hex: string): Uint8Array {
  return hexToBytes(hex.startsWith('0x') ? hex.slice(2) : hex);
}

/** Strip a 0x prefix if present. */
export function stripHexPrefix(hex: string): string {
  return hex.startsWith('0x') ? hex.slice(2) : hex;
}

export function bytesToBase64(bytes: Uint8Array): string {
  return base64.encode(bytes);
}

export function base64ToBytes(value: string): Uint8Array {
  return base64.decode(value);
}

export function utf8ToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
