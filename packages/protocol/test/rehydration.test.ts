import { secp256k1 } from '@noble/curves/secp256k1';
import { describe, expect, it } from 'vitest';
import {
  MemoryRehydrationKeyStore,
  buildRehydrationKeyTypedData,
  bytesToHex,
  createSlotKeyGrants,
  ethereumAddressFromPrivateKey,
  hashRehydrationKeyTypedData,
  loadOrCreateRehydrationKey,
  redactAndEncryptDocument,
  rehydrateGrantedDocument,
  type SignedRehydrationKeyAttestation,
} from '../src/index.js';

const registry = '0x1111111111111111111111111111111111111111';
const chainId = 11155111;
const now = 1_800_000_000n;
const source = 'Patient TEST PERSON called 555-0100.';
const spans = [
  { start: 8, end: 19, entityType: 'PERSON', slotId: 'person-1' },
  { start: 27, end: 35, entityType: 'PHONE_NUMBER', slotId: 'phone-1' },
];

function signAttestation(
  walletPrivateKey: Uint8Array,
  publicKey: string,
  overrides: Partial<{ wallet: string; chainId: number; verifyingContract: string; expiry: bigint }> = {},
): SignedRehydrationKeyAttestation {
  const typedData = buildRehydrationKeyTypedData({
    wallet: overrides.wallet ?? ethereumAddressFromPrivateKey(bytesToHex(walletPrivateKey)),
    publicKey,
    expiry: overrides.expiry ?? now + 3600n,
    chainId: overrides.chainId ?? chainId,
    verifyingContract: overrides.verifyingContract ?? registry,
  });
  const signed = secp256k1.sign(hashRehydrationKeyTypedData(typedData), walletPrivateKey, { prehash: false });
  const recovery = signed.recovery;
  if (recovery === undefined) throw new Error('Test signature has no recovery bit');
  return { ...typedData, signature: `0x${bytesToHex(signed.toCompactRawBytes())}${(recovery + 27).toString(16)}` };
}

describe('wallet-attested rehydration keys and selective grants', () => {
  it('persists, identifies, replaces, and removes keys through a storage adapter', async () => {
    const store = new MemoryRehydrationKeyStore();
    const first = await loadOrCreateRehydrationKey({ store, keyId: 'charlie' });
    expect(await loadOrCreateRehydrationKey({ store, keyId: 'charlie' })).toEqual(first);
    const replaced = await loadOrCreateRehydrationKey({ store, keyId: 'charlie', replace: true });
    expect(replaced.fingerprint).not.toBe(first.fingerprint);
    expect(replaced.publicKey).not.toBe(first.publicKey);
  });

  it('lets Charlie hydrate only granted fields while Mallory gets no plaintext', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const store = new MemoryRehydrationKeyStore();
    const charlieKey = await loadOrCreateRehydrationKey({ store, keyId: 'charlie' });
    const charlieWalletKey = secp256k1.utils.randomPrivateKey();
    const charlieWallet = ethereumAddressFromPrivateKey(bytesToHex(charlieWalletKey));
    const attestation = signAttestation(charlieWalletKey, charlieKey.publicKey);
    const grants = createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1'],
      attestation,
      expectedChainId: chainId,
      expectedVerifyingContract: registry,
      now,
    });

    expect(rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants,
      recipientWallet: charlieWallet,
      rehydrationKey: charlieKey,
    })).toBe('Patient TEST PERSON called {{sv:phone-1}}.');

    const malloryKey = await loadOrCreateRehydrationKey({ store, keyId: 'mallory' });
    const malloryWallet = ethereumAddressFromPrivateKey(bytesToHex(secp256k1.utils.randomPrivateKey()));
    expect(() => rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants,
      recipientWallet: malloryWallet,
      rehydrationKey: malloryKey,
    })).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_RECIPIENT' }));
  });

  it.each([
    ['expired', { expiry: now - 1n }, {}],
    ['wrong chain', {}, { expectedChainId: 1 }],
    ['wrong domain', {}, { expectedVerifyingContract: '0x2222222222222222222222222222222222222222' }],
  ] as const)('rejects an %s attestation', async (_label, overrides, expectedOverrides) => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const key = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const walletKey = secp256k1.utils.randomPrivateKey();
    const attestation = signAttestation(walletKey, key.publicKey, overrides);
    const expected = expectedOverrides as { expectedChainId?: number; expectedVerifyingContract?: string };
    expect(() => createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1'],
      attestation,
      expectedChainId: expected.expectedChainId ?? chainId,
      expectedVerifyingContract: expected.expectedVerifyingContract ?? registry,
      now,
    })).toThrow(expect.objectContaining({ code: 'INVALID_ATTESTATION' }));
  });

  it('rejects wrong-wallet, wrong-key, and tampered signatures', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const key = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const walletKey = secp256k1.utils.randomPrivateKey();
    const otherWallet = ethereumAddressFromPrivateKey(bytesToHex(secp256k1.utils.randomPrivateKey()));
    const wrongWallet = signAttestation(walletKey, key.publicKey, { wallet: otherWallet });
    const otherKey = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const wrongKey = { ...signAttestation(walletKey, key.publicKey), message: { ...signAttestation(walletKey, key.publicKey).message, rehydrationPublicKey: otherKey.publicKey } };
    const valid = signAttestation(walletKey, key.publicKey);
    const changedByte = valid.signature.slice(4, 6) === '00' ? '01' : '00';
    const tampered = { ...valid, signature: `${valid.signature.slice(0, 4)}${changedByte}${valid.signature.slice(6)}` };

    for (const attestation of [wrongWallet, wrongKey, tampered]) {
      expect(() => createSlotKeyGrants({
        slotKeys: document.slotKeys,
        slotIds: ['person-1'],
        attestation,
        expectedChainId: chainId,
        expectedVerifyingContract: registry,
        now,
      })).toThrow(expect.objectContaining({ code: 'INVALID_ATTESTATION' }));
    }
  });

  it('fails cryptographically when a wallet has the grant but not the attested private key', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const charlieKey = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const walletKey = secp256k1.utils.randomPrivateKey();
    const wallet = ethereumAddressFromPrivateKey(bytesToHex(walletKey));
    const grants = createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1'],
      attestation: signAttestation(walletKey, charlieKey.publicKey),
      expectedChainId: chainId,
      expectedVerifyingContract: registry,
      now,
    });
    const wrongPrivateKey = bytesToHex(secp256k1.utils.randomPrivateKey());
    expect(() => rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants,
      recipientWallet: wallet,
      rehydrationKey: { ...charlieKey, privateKey: wrongPrivateKey },
    })).toThrow(expect.objectContaining({ code: 'AUTHENTICATION_FAILED' }));
  });
});
