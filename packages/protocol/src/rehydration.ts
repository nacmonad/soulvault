import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  bytesToHex,
  concatBytes,
  hexToBytesFlexible,
  stripHexPrefix,
  utf8ToBytes,
} from './bytes.js';
import {
  sha256Hex,
  unwrapKeyWithSecp256k1PrivateKey,
  wrapKeyForSecp256k1PublicKey,
  type SecpWrappedKey,
} from './crypto.js';
import {
  DocumentProtocolError,
  rehydrateDocument,
  type DocumentSlotKey,
  type EncryptedDocumentSlot,
  type RedactedDocumentArtifact,
} from './document.js';

export const REHYDRATION_DOMAIN_NAME = 'SoulVaultDocuments' as const;
export const REHYDRATION_DOMAIN_VERSION = '1' as const;
export const REHYDRATION_KEY_PRIMARY_TYPE = 'RehydrationKey' as const;

export interface RehydrationKeyStore {
  get(keyId: string): Promise<string | null>;
  set(keyId: string, privateKeyHex: string): Promise<void>;
  remove(keyId: string): Promise<void>;
}

export class MemoryRehydrationKeyStore implements RehydrationKeyStore {
  readonly #values = new Map<string, string>();

  async get(keyId: string) { return this.#values.get(keyId) ?? null; }
  async set(keyId: string, privateKeyHex: string) { this.#values.set(keyId, privateKeyHex); }
  async remove(keyId: string) { this.#values.delete(keyId); }
}

export type RehydrationKey = {
  keyId: string;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
};

export async function loadOrCreateRehydrationKey(input: {
  store: RehydrationKeyStore;
  keyId?: string;
  replace?: boolean;
}): Promise<RehydrationKey> {
  const keyId = input.keyId ?? 'default';
  let privateKey = input.replace ? null : await input.store.get(keyId);
  if (privateKey !== null && !isValidPrivateKey(privateKey)) {
    throw new DocumentProtocolError('INVALID_INPUT', `Stored rehydration key ${keyId} is invalid`);
  }
  if (privateKey === null) {
    privateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
    await input.store.set(keyId, privateKey);
  }
  const publicKey = bytesToHex(secp256k1.getPublicKey(hexToBytesFlexible(privateKey), false));
  return { keyId, privateKey, publicKey, fingerprint: sha256Hex(hexToBytesFlexible(publicKey)) };
}

export async function removeRehydrationKey(store: RehydrationKeyStore, keyId = 'default'): Promise<void> {
  await store.remove(keyId);
}

export type RehydrationKeyDomain = {
  name: typeof REHYDRATION_DOMAIN_NAME;
  version: typeof REHYDRATION_DOMAIN_VERSION;
  chainId: number;
  verifyingContract: string;
};

export type RehydrationKeyMessage = {
  wallet: string;
  rehydrationPublicKey: string;
  expiry: bigint;
};

export type RehydrationKeyTypedData = {
  domain: RehydrationKeyDomain;
  primaryType: typeof REHYDRATION_KEY_PRIMARY_TYPE;
  types: {
    RehydrationKey: readonly [
      { readonly name: 'wallet'; readonly type: 'address' },
      { readonly name: 'rehydrationPublicKey'; readonly type: 'bytes' },
      { readonly name: 'expiry'; readonly type: 'uint64' },
    ];
  };
  message: RehydrationKeyMessage;
};

export type SignedRehydrationKeyAttestation = RehydrationKeyTypedData & { signature: string };

export function buildRehydrationKeyTypedData(input: {
  wallet: string;
  publicKey: string;
  expiry: bigint;
  chainId: number;
  verifyingContract: string;
}): RehydrationKeyTypedData {
  assertAddress(input.wallet, 'wallet');
  assertAddress(input.verifyingContract, 'verifying contract');
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new DocumentProtocolError('INVALID_INPUT', 'Chain id must be a positive safe integer');
  }
  if (input.expiry < 0n || input.expiry > 0xffffffffffffffffn) {
    throw new DocumentProtocolError('INVALID_INPUT', 'Attestation expiry must fit uint64');
  }
  assertPublicKey(input.publicKey);
  return {
    domain: {
      name: REHYDRATION_DOMAIN_NAME,
      version: REHYDRATION_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: normalizeAddress(input.verifyingContract),
    },
    primaryType: REHYDRATION_KEY_PRIMARY_TYPE,
    types: {
      RehydrationKey: [
        { name: 'wallet', type: 'address' },
        { name: 'rehydrationPublicKey', type: 'bytes' },
        { name: 'expiry', type: 'uint64' },
      ],
    },
    message: {
      wallet: normalizeAddress(input.wallet),
      rehydrationPublicKey: normalizeHex(input.publicKey),
      expiry: input.expiry,
    },
  };
}

export function hashRehydrationKeyTypedData(value: RehydrationKeyTypedData): Uint8Array {
  validateTypedDataShape(value);
  const domainTypeHash = keccak_256(utf8ToBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'));
  const domainSeparator = keccak_256(concatBytes(
    domainTypeHash,
    keccak_256(utf8ToBytes(value.domain.name)),
    keccak_256(utf8ToBytes(value.domain.version)),
    encodeUint(BigInt(value.domain.chainId)),
    encodeAddress(value.domain.verifyingContract),
  ));
  const messageTypeHash = keccak_256(utf8ToBytes('RehydrationKey(address wallet,bytes rehydrationPublicKey,uint64 expiry)'));
  const messageHash = keccak_256(concatBytes(
    messageTypeHash,
    encodeAddress(value.message.wallet),
    keccak_256(hexToBytesFlexible(value.message.rehydrationPublicKey)),
    encodeUint(value.message.expiry),
  ));
  return keccak_256(concatBytes(new Uint8Array([0x19, 0x01]), domainSeparator, messageHash));
}

export function verifyRehydrationKeyAttestation(input: {
  attestation: SignedRehydrationKeyAttestation;
  expectedWallet: string;
  expectedPublicKey: string;
  expectedChainId: number;
  expectedVerifyingContract: string;
  now: bigint;
}): void {
  const { attestation } = input;
  try {
    validateTypedDataShape(attestation);
    if (normalizeAddress(attestation.message.wallet) !== normalizeAddress(input.expectedWallet)) throw new Error('wallet mismatch');
    if (normalizeHex(attestation.message.rehydrationPublicKey) !== normalizeHex(input.expectedPublicKey)) throw new Error('public key mismatch');
    if (attestation.domain.chainId !== input.expectedChainId) throw new Error('chain mismatch');
    if (normalizeAddress(attestation.domain.verifyingContract) !== normalizeAddress(input.expectedVerifyingContract)) throw new Error('domain mismatch');
    if (attestation.message.expiry < input.now) throw new Error('attestation expired');
    const recovered = recoverEthereumAddress(hashRehydrationKeyTypedData(attestation), attestation.signature);
    if (recovered !== normalizeAddress(input.expectedWallet)) throw new Error('signature wallet mismatch');
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_ATTESTATION', 'Recipient rehydration-key attestation is invalid', { cause });
  }
}

export type SlotKeyGrant = {
  slotId: string;
  recipient: string;
  recipientKeyFingerprint: string;
  wrap: SecpWrappedKey;
};

export function createSlotKeyGrants(input: {
  slotKeys: DocumentSlotKey[];
  slotIds: string[];
  attestation: SignedRehydrationKeyAttestation;
  expectedChainId: number;
  expectedVerifyingContract: string;
  now: bigint;
}): SlotKeyGrant[] {
  verifyRehydrationKeyAttestation({
    attestation: input.attestation,
    expectedWallet: input.attestation.message.wallet,
    expectedPublicKey: input.attestation.message.rehydrationPublicKey,
    expectedChainId: input.expectedChainId,
    expectedVerifyingContract: input.expectedVerifyingContract,
    now: input.now,
  });
  const keys = new Map(input.slotKeys.map((value) => [value.slotId, value]));
  const uniqueIds = [...new Set(input.slotIds)];
  return uniqueIds.map((slotId) => {
    const key = keys.get(slotId);
    if (!key) throw new DocumentProtocolError('MISSING_SLOT', `No key exists for requested slot ${slotId}`);
    const publicKey = input.attestation.message.rehydrationPublicKey;
    return {
      slotId,
      recipient: normalizeAddress(input.attestation.message.wallet),
      recipientKeyFingerprint: sha256Hex(hexToBytesFlexible(publicKey)),
      wrap: wrapKeyForSecp256k1PublicKey(key.key, publicKey),
    };
  });
}

export function rehydrateGrantedDocument(input: {
  artifact: RedactedDocumentArtifact;
  encryptedSlots: EncryptedDocumentSlot[];
  grants: SlotKeyGrant[];
  recipientWallet: string;
  rehydrationKey: RehydrationKey;
}): string {
  assertAddress(input.recipientWallet, 'recipient wallet');
  const recipient = normalizeAddress(input.recipientWallet);
  const fingerprint = sha256Hex(hexToBytesFlexible(input.rehydrationKey.publicKey));
  const relevant = input.grants.filter((grant) =>
    normalizeAddress(grant.recipient) === recipient && grant.recipientKeyFingerprint === fingerprint,
  );
  if (relevant.length === 0) {
    throw new DocumentProtocolError('UNAUTHORIZED_RECIPIENT', 'No slot grants match this wallet and rehydration key');
  }
  const slotKeys = relevant.map((grant) => {
    try {
      return {
        slotId: grant.slotId,
        key: unwrapKeyWithSecp256k1PrivateKey(grant.wrap, input.rehydrationKey.privateKey),
      };
    } catch (cause) {
      throw new DocumentProtocolError('AUTHENTICATION_FAILED', `Could not unwrap granted slot ${grant.slotId}`, { cause });
    }
  });
  return rehydrateDocument({
    artifact: input.artifact,
    encryptedSlots: input.encryptedSlots,
    slotKeys,
    allowPartial: true,
  });
}

export function ethereumAddressFromPrivateKey(privateKey: string): string {
  return ethereumAddressFromPublicKey(secp256k1.getPublicKey(hexToBytesFlexible(privateKey), false));
}

function recoverEthereumAddress(digest: Uint8Array, signatureHex: string): string {
  const signature = hexToBytesFlexible(signatureHex);
  if (signature.length !== 65) throw new Error('signature must contain r, s, and v');
  const recovery = signature[64] >= 27 ? signature[64] - 27 : signature[64];
  if (recovery !== 0 && recovery !== 1) throw new Error('invalid recovery bit');
  const publicKey = secp256k1.Signature.fromCompact(signature.subarray(0, 64))
    .addRecoveryBit(recovery)
    .recoverPublicKey(digest)
    .toRawBytes(false);
  return ethereumAddressFromPublicKey(publicKey);
}

function ethereumAddressFromPublicKey(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false);
  return `0x${bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12))}`;
}

function validateTypedDataShape(value: RehydrationKeyTypedData): void {
  if (value.domain.name !== REHYDRATION_DOMAIN_NAME || value.domain.version !== REHYDRATION_DOMAIN_VERSION || value.primaryType !== REHYDRATION_KEY_PRIMARY_TYPE) {
    throw new Error('wrong EIP-712 domain or primary type');
  }
  assertAddress(value.domain.verifyingContract, 'verifying contract');
  assertAddress(value.message.wallet, 'wallet');
  assertPublicKey(value.message.rehydrationPublicKey);
}

function encodeUint(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new Error('integer is outside uint256');
  return hexToBytesFlexible(value.toString(16).padStart(64, '0'));
}

function encodeAddress(value: string): Uint8Array {
  return hexToBytesFlexible(stripHexPrefix(normalizeAddress(value)).padStart(64, '0'));
}

function assertAddress(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new DocumentProtocolError('INVALID_INPUT', `${label} must be an Ethereum address`);
}

function normalizeAddress(value: string): string {
  assertAddress(value, 'address');
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function assertPublicKey(value: string): void {
  try {
    secp256k1.ProjectivePoint.fromHex(hexToBytesFlexible(value));
  } catch (cause) {
    throw new DocumentProtocolError('INVALID_INPUT', 'Rehydration public key is invalid', { cause });
  }
}

function normalizeHex(value: string): string {
  return `0x${stripHexPrefix(value).toLowerCase()}`;
}

function isValidPrivateKey(value: string): boolean {
  try { return secp256k1.utils.isValidPrivateKey(hexToBytesFlexible(value)); }
  catch { return false; }
}
