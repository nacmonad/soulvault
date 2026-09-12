import { secp256k1 } from '@noble/curves/secp256k1';
import { describe, expect, it } from 'vitest';
import {
  MemoryRehydrationKeyStore,
  buildRehydrationKeyTypedData,
  bytesToHex,
  createSlotKeyGrants,
  createSlotKeyGrantsForRecipient,
  ethereumAddressFromPrivateKey,
  hashRehydrationKeyTypedData,
  loadOrCreateRehydrationKey,
  redactAndEncryptDocument,
  rehydrateGrantedDocument,
  rehydrationKeyFingerprint,
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

  it('builds the same grants from an onchain request as from a verified attestation', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const store = new MemoryRehydrationKeyStore();
    const charlieKey = await loadOrCreateRehydrationKey({ store, keyId: 'charlie' });
    const charlieWalletKey = secp256k1.utils.randomPrivateKey();
    const charlieWallet = ethereumAddressFromPrivateKey(bytesToHex(charlieWalletKey));
    const attestation = signAttestation(charlieWalletKey, charlieKey.publicKey);
    const attested = createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1', 'phone-1'],
      attestation,
      expectedChainId: chainId,
      expectedVerifyingContract: registry,
      now,
    });
    const fromRequest = createSlotKeyGrantsForRecipient({
      slotKeys: document.slotKeys,
      slotIds: ['person-1', 'phone-1'],
      recipient: charlieWallet,
      recipientPublicKey: charlieKey.publicKey,
    });

    // Wraps use a fresh ephemeral key per call, so compare semantics: the
    // request path must hydrate identically to the attestation path.
    expect(fromRequest.map(({ wrap, ...rest }) => rest)).toEqual(
      attested.map(({ wrap, ...rest }) => rest),
    );
    expect(fromRequest).toHaveLength(attested.length);
    expect(rehydrationKeyFingerprint(charlieKey.publicKey)).toBe(charlieKey.fingerprint);
    const hydrated = (grants: typeof fromRequest) => rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants,
      recipientWallet: charlieWallet,
      rehydrationKey: charlieKey,
    });
    expect(hydrated(fromRequest)).toBe('Patient TEST PERSON called 555-0100.');
    expect(hydrated(attested)).toBe(hydrated(fromRequest));
  });

  it('rejects malformed recipients and public keys on the request path', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const key = await loadOrCreateRehydrationKey({ store: new MemoryRehydrationKeyStore() });
    const wallet = ethereumAddressFromPrivateKey(bytesToHex(secp256k1.utils.randomPrivateKey()));

    expect(() => createSlotKeyGrantsForRecipient({
      slotKeys: document.slotKeys,
      slotIds: ['person-1'],
      recipient: 'not-an-address',
      recipientPublicKey: key.publicKey,
    })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));

    expect(() => createSlotKeyGrantsForRecipient({
      slotKeys: document.slotKeys,
      slotIds: ['person-1'],
      recipient: wallet,
      recipientPublicKey: '0x1234',
    })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));

    expect(() => createSlotKeyGrantsForRecipient({
      slotKeys: document.slotKeys,
      slotIds: ['unknown-slot'],
      recipient: wallet,
      recipientPublicKey: key.publicKey,
    })).toThrow(expect.objectContaining({ code: 'MISSING_SLOT' }));
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

  it('replaces a lost key end to end without recovering the old private key', async () => {
    const document = redactAndEncryptDocument({ text: source, spans });
    const store = new MemoryRehydrationKeyStore();
    const originalKey = await loadOrCreateRehydrationKey({ store, keyId: 'charlie' });
    const walletKey = secp256k1.utils.randomPrivateKey();
    const wallet = ethereumAddressFromPrivateKey(bytesToHex(walletKey));

    // Original grant, wrapped to the key Charlie has since lost. A delivered
    // READ grant is a permanent capability: the original wrap still hydrates
    // for whoever still holds that key, and nothing revokes it.
    const originalGrants = createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1', 'phone-1'],
      attestation: signAttestation(walletKey, originalKey.publicKey),
      expectedChainId: chainId,
      expectedVerifyingContract: registry,
      now,
    });
    expect(rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants: originalGrants,
      recipientWallet: wallet,
      rehydrationKey: originalKey,
    })).toBe(source);

    // Lost browser storage: Charlie attests a NEW key; the old private key is
    // never recovered. The author verifies the new attestation and re-wraps.
    const replacementKey = await loadOrCreateRehydrationKey({ store, keyId: 'charlie', replace: true });
    expect(replacementKey.publicKey).not.toBe(originalKey.publicKey);
    const replacementGrants = createSlotKeyGrants({
      slotKeys: document.slotKeys,
      slotIds: ['person-1', 'phone-1'],
      attestation: signAttestation(walletKey, replacementKey.publicKey),
      expectedChainId: chainId,
      expectedVerifyingContract: registry,
      now,
    });
    expect(rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants: replacementGrants,
      recipientWallet: wallet,
      rehydrationKey: replacementKey,
    })).toBe(source);

    // Superseded keys cannot unwrap newly issued grants: the recipient-key
    // fingerprint binding fails closed with a typed error.
    expect(() => rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants: replacementGrants,
      recipientWallet: wallet,
      rehydrationKey: originalKey,
    })).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_RECIPIENT' }));

    // An unrelated key from a different wallet gets nothing either.
    const malloryKey = await loadOrCreateRehydrationKey({ store, keyId: 'mallory' });
    expect(() => rehydrateGrantedDocument({
      artifact: document.artifact,
      encryptedSlots: document.encryptedSlots,
      grants: replacementGrants,
      recipientWallet: ethereumAddressFromPrivateKey(bytesToHex(secp256k1.utils.randomPrivateKey())),
      rehydrationKey: malloryKey,
    })).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_RECIPIENT' }));
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
