import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createPublicClient, decodeEventLog, http, type Address, type Chain } from 'viem';
import { makeTestProvider } from '../../test/helpers/provider.js';
import { loadForgeArtifact, deployContract } from '../../test/helpers/forge-artifacts.js';
import {
  SECP_WRAP_ALGORITHM,
  hexToBytesFlexible,
  sha256Hex,
  utf8ToBytes,
  loadOrCreateRehydrationKey,
  MemoryRehydrationKeyStore,
  buildRehydrationKeyTypedData,
  createSlotKeyGrants,
  redactAndEncryptDocument,
  serializePublicDocumentBundle,
  parsePublicDocumentBundle,
  rehydrateGrantedDocument,
  DocumentProtocolError,
  type SecpWrappedKey,
} from '@soulvault/protocol';

/**
 * Integration test for ticket #9 — publish and resolve a complete document
 * grant through registry events (docs/redaction-hydration-spec.md §§3–4).
 *
 * Full backend-free v0 flow against a real local chain:
 *   1. Alice redacts a synthetic document client-side and anchors its
 *      integrity (docHash + slot list — never ciphertexts) on a deployed
 *      SoulVaultDocumentRegistry.
 *   2. Charlie holds a wallet-attested rehydration keypair; Alice verifies
 *      the attestation, wraps selected slot keys to Charlie's pubkey, and
 *      delivers them via SlotKeyGranted events (the grant event IS the key
 *      delivery).
 *   3. Charlie receives only the JSON bundle file + the public chain log,
 *      verifies the bundle against the on-chain anchor, derives his grants
 *      from ordered logs, unwraps, and hydrates. Ungranted fields stay
 *      redacted (partial hydration).
 *   4. Mallory resolves the same public surfaces and receives nothing.
 *
 * A delivered READ grant is a permanent capability: no revocation, no
 * expiry (spec §3). Run with: pnpm test:integration (requires a local node
 * on SOULVAULT_RPC_URL — see .env.test.example).
 */

/**
 * Document wire surface, mirrored from apps/web/src/lib/onchain/abis.ts.
 * The browser event layer must decode REAL emitted payloads into the shared
 * protocol wire types, so this test decodes with the same viem path.
 */
const DOCUMENT_EVENT_ABI = [
  {
    type: 'event',
    name: 'DocumentPublished',
    inputs: [
      { name: 'docHash', type: 'bytes32', indexed: true },
      { name: 'author', type: 'address', indexed: true },
      { name: 'slotIds', type: 'string[]', indexed: false },
      { name: 'selfieRequired', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SlotKeyGranted',
    inputs: [
      { name: 'docHash', type: 'bytes32', indexed: true },
      { name: 'slotId', type: 'string', indexed: false },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'wrappedKey', type: 'string', indexed: false },
      { name: 'algorithm', type: 'string', indexed: false },
      { name: 'ephemeralPublicKey', type: 'string', indexed: false },
      { name: 'nonce', type: 'string', indexed: false },
    ],
  },
] as const;

const EMAIL = 'jane.sample@example.com';
const SALARY = '128000';

/**
 * Distinct per test: the registry dedupes republished docHashes by the same
 * author (idempotent, no event), so two tests sharing one document would
 * collide on-chain and the second test would see zero events of its own.
 */
function makeDocument(variant: string): string {
  return [
    `Employee record for Jane Q. Sample. (${variant})`,
    'Her personal email is jane.sample@example.com and her salary is 128000 USD.',
    'This sentence stays visible to everyone.',
  ].join('\n');
}

function makeSensitiveSpans(text: string) {
  return [
    {
      start: text.indexOf(EMAIL),
      end: text.indexOf(EMAIL) + EMAIL.length,
      entityType: 'EMAIL',
      slotId: 'sv_email_1',
    },
    {
      start: text.indexOf(SALARY),
      end: text.indexOf(SALARY) + SALARY.length,
      entityType: 'MONEY',
      slotId: 'sv_salary_1',
    },
  ];
}

type DecodedDocumentEvent =
  | {
      eventName: 'DocumentPublished';
      blockNumber: bigint;
      logIndex: number;
      docHash: string;
      author: Address;
      slotIds: string[];
    }
  | {
      eventName: 'SlotKeyGranted';
      blockNumber: bigint;
      logIndex: number;
      docHash: string;
      slotId: string;
      recipient: Address;
      wrap: SecpWrappedKey;
    };

/** Anvil default accounts 1 and 2 (mnemonic "test ... junk"). */
const CHARLIE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MALLORY_KEY = '0xdbda1821b80551c9d65939329250298ae3432ed2d4b830c00a4bd4fd42cd488c';

describe('document registry grant flow (ticket #9 integration)', () => {
  let provider: JsonRpcProvider;
  let viemClient: ReturnType<typeof createPublicClient>;
  let chain: Chain;
  let chainId: number;
  let alice: Wallet; // document author (anvil account[0] via SOULVAULT_PRIVATE_KEY)
  let charlie: Wallet; // recipient
  let mallory: Wallet; // adversary
  let registry: Contract; // connected to alice
  let registryAddress: Address;

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (global-setup should populate it)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (global-setup should populate it)');

    provider = makeTestProvider(rpcUrl);
    alice = new Wallet(privateKey, provider);
    charlie = new Wallet(CHARLIE_KEY, provider);
    mallory = new Wallet(MALLORY_KEY, provider);

    const artifact = loadForgeArtifact('SoulVaultDocumentRegistry');
    const deployed = await deployContract(alice, artifact);
    // ethers v6: Contract exposes .target/getAddress(), not .address.
    registryAddress = (await deployed.getAddress()) as Address;
    registry = deployed.connect(alice);

    const net = await provider.getNetwork();
    chainId = Number(net.chainId);
    chain = {
      id: chainId,
      name: 'soulvault-local',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
    viemClient = createPublicClient({ chain, transport: http(rpcUrl) });
  });

  /** Fetch + decode all document events from the registry, ordered by (blockNumber, logIndex). */
  async function fetchDocumentEvents(): Promise<DecodedDocumentEvent[]> {
    // cacheTime: 0 — viem caches getBlockNumber per client; without this a
    // second scan in the same file can read a stale tip and miss recent events.
    const latest = await viemClient.getBlockNumber({ cacheTime: 0 });
    const logs = await viemClient.getLogs({ address: registryAddress, fromBlock: 0n, toBlock: latest });
    const decoded: DecodedDocumentEvent[] = [];
    for (const log of logs) {
      let event: ReturnType<typeof decodeEventLog>;
      try {
        event = decodeEventLog({ abi: DOCUMENT_EVENT_ABI, data: log.data, topics: log.topics });
      } catch {
        continue; // not a document event
      }
      const meta = { blockNumber: log.blockNumber ?? 0n, logIndex: log.logIndex ?? 0 };
      if (event.eventName === 'DocumentPublished') {
        decoded.push({
          ...meta,
          eventName: 'DocumentPublished',
          docHash: event.args.docHash as string,
          author: event.args.author as Address,
          slotIds: event.args.slotIds as string[],
        });
      } else if (event.eventName === 'SlotKeyGranted') {
        decoded.push({
          ...meta,
          eventName: 'SlotKeyGranted',
          docHash: event.args.docHash as string,
          slotId: event.args.slotId as string,
          recipient: event.args.recipient as Address,
          wrap: {
            wrappedKey: event.args.wrappedKey as string,
            algorithm: event.args.algorithm as string,
            ephemeralPublicKey: event.args.ephemeralPublicKey as string,
            nonce: event.args.nonce as string,
          },
        });
      }
    }
    return decoded.sort((a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex);
  }

  /** Wallet-attested rehydration keypair (browser pattern: persistent keypair + EIP-712 attestation). */
  async function attestedRehydrationKey(wallet: Wallet) {
    const store = new MemoryRehydrationKeyStore();
    const rehydrationKey = await loadOrCreateRehydrationKey({ store, keyId: wallet.address });
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const typedData = buildRehydrationKeyTypedData({
      wallet: wallet.address,
      publicKey: rehydrationKey.publicKey,
      expiry,
      chainId,
      verifyingContract: registryAddress,
    });
    const signature = await wallet.signTypedData(
      typedData.domain,
      { RehydrationKey: typedData.types.RehydrationKey },
      typedData.message,
    );
    return { rehydrationKey, attestation: { ...typedData, signature } };
  }

  it('publishes the anchor, delivers grants as events, and Charlie hydrates from bundle + logs alone', async () => {
    // --- Alice, client-side only: redact + encrypt, then anchor on-chain ---
    const text = makeDocument('full-grant');
    const redacted = redactAndEncryptDocument({ text, spans: makeSensitiveSpans(text) });
    const bundleJson = serializePublicDocumentBundle({
      artifact: redacted.artifact,
      encryptedSlots: redacted.encryptedSlots,
    });
    // The file lane must never carry secrets.
    expect(bundleJson).not.toContain(EMAIL);
    expect(bundleJson).not.toContain(SALARY);

    // docHash = sha256 of the serialized public bundle (the integrity anchor
    // Charlie can recompute from the file alone). sha256Hex is bare hex; the
    // contract ABI wants a 0x-prefixed bytes32.
    const docHash = `0x${sha256Hex(utf8ToBytes(bundleJson))}`;
    const slotIds = redacted.artifact.slots.map((slot) => slot.slotId).sort();

    const publishTx = await registry.publishDocument(docHash, slotIds);
    await publishTx.wait();

    // --- Grant: wallet-attested recipient key, wrap selected slots, emit event ---
    const { rehydrationKey, attestation } = await attestedRehydrationKey(charlie);
    const grants = createSlotKeyGrants({
      slotKeys: redacted.slotKeys,
      slotIds, // grant BOTH slots here; Mallory's rejection is proven below
      attestation,
      expectedChainId: chainId,
      expectedVerifyingContract: registryAddress,
      now: BigInt(Math.floor(Date.now() / 1000)),
    });
    expect(grants).toHaveLength(2);
    for (const grant of grants) {
      expect(grant.wrap.algorithm).toBe(SECP_WRAP_ALGORITHM);
      const grantTx = await registry.grantSlotKey(
        docHash,
        grant.slotId,
        grant.recipient,
        grant.wrap.wrappedKey,
        grant.wrap.algorithm,
        grant.wrap.ephemeralPublicKey,
        grant.wrap.nonce,
      );
      await grantTx.wait();
    }

    // --- Charlie: resolve events from the public log, derive his grants ---
    const events = await fetchDocumentEvents();
    const published = events.find(
      (event): event is Extract<DecodedDocumentEvent, { eventName: 'DocumentPublished' }> =>
        event.eventName === 'DocumentPublished' && event.docHash === docHash,
    );
    expect(published).toBeDefined();
    expect(published!.slotIds.sort()).toEqual(slotIds);
    expect(published!.author.toLowerCase()).toBe(alice.address.toLowerCase());

    // Charlie verifies the bundle he received against the on-chain anchor.
    // The event carries a bare-bytes32 docHash; sha256Hex returns bare hex —
    // normalize both sides before comparing.
    const receivedBundle = parsePublicDocumentBundle(bundleJson);
    expect(sha256Hex(utf8ToBytes(serializePublicDocumentBundle(receivedBundle)))).toBe(
      published!.docHash.replace(/^0x/, ''),
    );

    // Build protocol grants from the resolved events. The fingerprint binding
    // (recipient wallet + rehydration pubkey) comes from Charlie's attestation
    // — the same value Alice recorded at grant time.
    const charlieFingerprint = sha256Hex(hexToBytesFlexible(attestation.message.rehydrationPublicKey));
    const resolvedGrants = events
      .filter(
        (event): event is Extract<DecodedDocumentEvent, { eventName: 'SlotKeyGranted' }> =>
          event.eventName === 'SlotKeyGranted' && event.docHash === docHash,
      )
      .map((event) => ({
        slotId: event.slotId,
        recipient: event.recipient,
        recipientKeyFingerprint: charlieFingerprint,
        wrap: event.wrap,
      }));
    expect(resolvedGrants).toHaveLength(2);

    // Both slots were granted, so Charlie's view hydrates fully.
    const hydrated = rehydrateGrantedDocument({
      artifact: receivedBundle.artifact,
      encryptedSlots: receivedBundle.encryptedSlots,
      grants: resolvedGrants,
      recipientWallet: charlie.address,
      rehydrationKey,
    });
    expect(hydrated).toBe(text);
  });

  it('partial grants leave ungranted fields redacted and Mallory gets nothing', async () => {
    // Fresh document with DISTINCT content (see makeDocument) so its docHash
    // differs from the first test's and this publish emits its own events.
    const text = makeDocument('partial-grant');
    const redacted = redactAndEncryptDocument({ text, spans: makeSensitiveSpans(text) });
    const bundleJson = serializePublicDocumentBundle({
      artifact: redacted.artifact,
      encryptedSlots: redacted.encryptedSlots,
    });
    const docHash = `0x${sha256Hex(utf8ToBytes(bundleJson))}`;
    const slotIds = redacted.artifact.slots.map((slot) => slot.slotId).sort();

    const publishTx = await registry.publishDocument(docHash, slotIds);
    await publishTx.wait();

    // Grant ONLY the email slot to Charlie.
    const { rehydrationKey, attestation } = await attestedRehydrationKey(charlie);
    const emailGrants = createSlotKeyGrants({
      slotKeys: redacted.slotKeys,
      slotIds: ['sv_email_1'],
      attestation,
      expectedChainId: chainId,
      expectedVerifyingContract: registryAddress,
      now: BigInt(Math.floor(Date.now() / 1000)),
    });
    for (const grant of emailGrants) {
      const grantTx = await registry.grantSlotKey(
        docHash,
        grant.slotId,
        grant.recipient,
        grant.wrap.wrappedKey,
        grant.wrap.algorithm,
        grant.wrap.ephemeralPublicKey,
        grant.wrap.nonce,
      );
      await grantTx.wait();
    }

    // Charlie resolves the same public surfaces.
    const events = await fetchDocumentEvents();
    const charlieFingerprint = sha256Hex(hexToBytesFlexible(attestation.message.rehydrationPublicKey));
    const resolvedGrants = events
      .filter(
        (event): event is Extract<DecodedDocumentEvent, { eventName: 'SlotKeyGranted' }> =>
          event.eventName === 'SlotKeyGranted' && event.docHash === docHash,
      )
      .map((event) => ({
        slotId: event.slotId,
        recipient: event.recipient,
        recipientKeyFingerprint: charlieFingerprint,
        wrap: event.wrap,
      }));
    expect(resolvedGrants).toHaveLength(1);

    const receivedBundle = parsePublicDocumentBundle(bundleJson);
    const hydrated = rehydrateGrantedDocument({
      artifact: receivedBundle.artifact,
      encryptedSlots: receivedBundle.encryptedSlots,
      grants: resolvedGrants,
      recipientWallet: charlie.address,
      rehydrationKey,
    });
    // Granted field reveals; ungranted field stays redacted.
    expect(hydrated).toContain(EMAIL);
    expect(hydrated).not.toContain(SALARY);
    expect(hydrated).toContain('{{sv:sv_salary_1}}');

    // Mallory: no grants match his wallet/key → hydration fails closed.
    const malloryStore = new MemoryRehydrationKeyStore();
    const malloryKey = await loadOrCreateRehydrationKey({ store: malloryStore, keyId: mallory.address });
    expect(() =>
      rehydrateGrantedDocument({
        artifact: receivedBundle.artifact,
        encryptedSlots: receivedBundle.encryptedSlots,
        grants: resolvedGrants,
        recipientWallet: mallory.address,
        rehydrationKey: malloryKey,
      }),
    ).toThrow(DocumentProtocolError);
  });
});
