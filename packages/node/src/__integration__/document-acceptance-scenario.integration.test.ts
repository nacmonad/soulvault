import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { createPublicClient, decodeEventLog, http, type Address, type Chain } from 'viem';
import { makeTestProvider } from '../../test/helpers/provider.js';
import { loadForgeArtifact, deployContract } from '../../test/helpers/forge-artifacts.js';
import { analyzeText } from '@soulvault/presidio-adapter';
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
  MemoryExternalSlotStore,
  externalizeSlots,
  resolveExternalSlots,
  isExternallyLocated,
  DocumentProtocolError,
  type SecpWrappedKey,
} from '@soulvault/protocol';

/**
 * Ticket #12 — the complete Alice, Charlie, and Mallory acceptance scenario.
 *
 * One reproducible headless flow against a real local chain:
 *   1. ALICE (Node consumer): presidio-web analysis + deterministic finding
 *      review (accept the analyzer-detected findings) →
 *      redactAndEncryptDocument → integrity-bound overflow externalization
 *      (the oversized notes slot to the external store, small slots stay
 *      inline) → publish the docHash anchor → wrap selected slot keys to
 *      Charlie's wallet-attested key → deliver grants as SlotKeyGranted
 *      events. The bundle file she hands Charlie carries no plaintext.
 *   2. CHARLIE (browser-pattern consumer): verifies the received bundle file
 *      against the on-chain anchor, resolves live registry events decoded
 *      with the SAME ABI path the web app's watcher uses
 *      (apps/web/src/lib/onchain), integrity-checks and resolves the
 *      external record, unwraps his grants, and hydrates EXACTLY his
 *      delivered grants — the ungranted email slot stays a redacted marker.
 *   3. MALLORY: same public surfaces, different wallet/key → typed
 *      UNAUTHORIZED_RECIPIENT failure; no plaintext through the public API.
 *
 * Permanence (spec §3): a delivered READ grant is a permanent capability.
 * No revocation, expiry, or erasure mechanism exists in v0 and none is
 * asserted here; the scenario proves Charlie's hydrated view is exactly his
 * delivered grants — nothing more, nothing less.
 *
 * Run (one command; global-setup runs `forge build` and probes the node):
 *   pnpm --filter @soulvault/node test:acceptance
 * (requires the local node configured in .env.test — see .env.test.example)
 */

/** Mirrored from apps/web/src/lib/onchain/abis.ts — same wire format. */
const DOCUMENT_EVENT_ABI = [
  {
    type: 'event',
    name: 'DocumentPublished',
    inputs: [
      { name: 'docHash', type: 'bytes32', indexed: true },
      { name: 'author', type: 'address', indexed: true },
      { name: 'slotIds', type: 'string[]', indexed: false },
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

/** Anvil default accounts 1 and 2 (mnemonic "test ... junk"). */
const CHARLIE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const MALLORY_KEY = '0xdbda1821b80551c9d65939329250298ae3432ed2d4b830c00a4bd4fd42cd488c';

const EMAIL = 'jane.sample@example.com';
/** Presidio's PhoneRecognizer matches the parenthesized form (without country code). */
const PHONE = '(555) 010-4321';
const NOTES_SENTENCE = 'regular monitoring and lab work. ';
/** Repeat count sized so the sealed notes ciphertext (~76 KB) crosses the
 * default 64 KiB overflow threshold while email/phone stay inline. */
const NOTES_REPEAT = 2400;

/** Big enough that the notes slot crosses the default 64 KiB overflow threshold. */
function acceptanceDocument(): string {
  return [
    'Patient record for Jane Q. Sample.',
    `Contact email ${EMAIL}, phone ${PHONE}.`,
    `Clinical notes: ${NOTES_SENTENCE.repeat(NOTES_REPEAT)}`,
    'This closing sentence stays visible to everyone.',
  ].join(' ');
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

describe('Alice, Charlie, and Mallory acceptance scenario (ticket #12)', () => {
  let provider: JsonRpcProvider;
  let viemClient: ReturnType<typeof createPublicClient>;
  let chainId: number;
  let alice: Wallet;
  let charlie: Wallet;
  let mallory: Wallet;
  let registry: Contract;
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
    registryAddress = (await deployed.getAddress()) as Address;
    registry = deployed.connect(alice);

    const net = await provider.getNetwork();
    chainId = Number(net.chainId);
    const chain: Chain = {
      id: chainId,
      name: 'soulvault-local',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    };
    viemClient = createPublicClient({ chain, transport: http(rpcUrl) });
  });

  /** Fetch + decode document events, ordered by (blockNumber, logIndex). */
  async function fetchDocumentEvents(): Promise<DecodedDocumentEvent[]> {
    // cacheTime: 0 — a second scan in the same file must not read a stale tip.
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

  /** Wallet-attested rehydration keypair (the browser pattern, on Node). */
  async function attestedRehydrationKey(wallet: Wallet, store: MemoryRehydrationKeyStore) {
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

  it('proves the full public headless flow: detect → redact → overflow → anchor → grant → hydrate', async () => {
    const text = acceptanceDocument();

    // --- ALICE (Node): presidio-web detection + deterministic review --------
    // No hand-listed spans: findings come from the real presidio analyzer.
    const findings = analyzeText(text);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    const emailFinding = findings.find((f) => text.slice(f.start, f.end) === EMAIL);
    const phoneFinding = findings.find((f) => text.slice(f.start, f.end) === PHONE);
    expect(emailFinding).toBeDefined();
    expect(phoneFinding).toBeDefined();

    // Alice reviews: accept the detected findings. The oversized notes blob is
    // a third slot so the overflow path carries real bulk. Review is
    // deterministic: accepted-only findings become encryption spans.
    const acceptedSpans = [emailFinding!, phoneFinding!].map(({ start, end, entityType, slotId }) => ({
      start,
      end,
      entityType,
      slotId,
    }));
    const notesStart = text.indexOf(NOTES_SENTENCE);
    const notesEnd = notesStart + NOTES_SENTENCE.length * NOTES_REPEAT;
    acceptedSpans.push({ start: notesStart, end: notesEnd, entityType: 'MEDICAL', slotId: 'notes-overflow' });

    const redacted = redactAndEncryptDocument({ text, spans: acceptedSpans });
    const docHashOf = (bundleJson: string) => `0x${sha256Hex(utf8ToBytes(bundleJson))}`;

    // Integrity-bound overflow: ONLY the big slot moves out of the bundle.
    const store = new MemoryExternalSlotStore();
    const initialBundleJson = serializePublicDocumentBundle({
      artifact: redacted.artifact,
      encryptedSlots: redacted.encryptedSlots,
    });
    const { bundle, externalized } = await externalizeSlots({
      bundle: parsePublicDocumentBundle(initialBundleJson),
      store,
    });
    expect(externalized.map((item) => item.slotId)).toEqual(['notes-overflow']);
    const located = bundle.encryptedSlots.filter(isExternallyLocated);
    expect(located).toHaveLength(1);
    expect(located[0].ciphertext).toBeUndefined();
    expect(located[0].external.byteLength).toBeGreaterThan(0);
    // Small slots stayed inline; grants and hydration semantics are unchanged.
    expect(bundle.encryptedSlots.length - located.length).toBe(2);

    // The shareable bundle file must carry none of the removed plaintext.
    const bundleJson = serializePublicDocumentBundle(bundle);
    expect(bundleJson).not.toContain(EMAIL);
    expect(bundleJson).not.toContain(PHONE);
    expect(bundleJson).not.toContain('monitoring and lab work');

    // --- ALICE: publish the integrity anchor (docHash of the FINAL bundle) ---
    const docHash = docHashOf(bundleJson);
    const slotIds = bundle.encryptedSlots.map((slot) => slot.slotId).sort();
    await (await registry.publishDocument(docHash, slotIds)).wait();

    // --- ALICE: grant email+notes to Charlie's wallet-attested key. The
    // phone slot is deliberately NOT granted: Charlie's view must prove
    // "exactly delivered grants — nothing more, nothing less." ---
    const charlieStore = new MemoryRehydrationKeyStore();
    const { rehydrationKey, attestation } = await attestedRehydrationKey(charlie, charlieStore);
    // Grants are issued for the email slot and the overflow notes slot only.
    const grants = createSlotKeyGrants({
      slotKeys: redacted.slotKeys,
      slotIds: [emailFinding!.slotId, 'notes-overflow'],
      attestation,
      expectedChainId: chainId,
      expectedVerifyingContract: registryAddress,
      now: BigInt(Math.floor(Date.now() / 1000)),
    });
    expect(grants).toHaveLength(2);
    for (const grant of grants) {
      expect(grant.wrap.algorithm).toBe(SECP_WRAP_ALGORITHM);
      await (
        await registry.grantSlotKey(
          docHash,
          grant.slotId,
          grant.recipient,
          grant.wrap.wrappedKey,
          grant.wrap.algorithm,
          grant.wrap.ephemeralPublicKey,
          grant.wrap.nonce,
        )
      ).wait();
    }

    // --- CHARLIE (browser-pattern): verify the file against the chain ---
    const events = await fetchDocumentEvents();
    const published = events.find(
      (event): event is Extract<DecodedDocumentEvent, { eventName: 'DocumentPublished' }> =>
        event.eventName === 'DocumentPublished' && event.docHash === docHash,
    );
    expect(published).toBeDefined();
    expect(published!.author.toLowerCase()).toBe(alice.address.toLowerCase());
    const receivedBundle = parsePublicDocumentBundle(bundleJson);
    expect(sha256Hex(utf8ToBytes(serializePublicDocumentBundle(receivedBundle)))).toBe(
      published!.docHash.replace(/^0x/, ''),
    );

    // --- CHARLIE: resolve his grants from the live event log (same decode
    // path as apps/web/src/lib/onchain) and resolve the external record ---
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
    const resolved = await resolveExternalSlots(receivedBundle, store);
    expect(resolved.resolvedSlotIds).toEqual(['notes-overflow']);

    // Charlie hydrates EXACTLY his delivered grants: email + notes come back,
    // the ungranted phone slot stays a redacted marker.
    const hydrated = rehydrateGrantedDocument({
      artifact: resolved.bundle.artifact,
      encryptedSlots: resolved.bundle.encryptedSlots,
      grants: resolvedGrants,
      recipientWallet: charlie.address,
      rehydrationKey,
    });
    expect(hydrated).toContain(EMAIL);
    expect(hydrated).toContain('monitoring and lab work');
    expect(hydrated).toContain('{{sv:' + phoneFinding!.slotId + '}}');
    expect(hydrated).not.toContain(PHONE);
    expect(hydrated.endsWith('This closing sentence stays visible to everyone.')).toBe(true);

    // --- MALLORY: same public surfaces, zero plaintext ---
    const malloryStore = new MemoryRehydrationKeyStore();
    const { rehydrationKey: malloryKey, attestation: malloryAttestation } = await attestedRehydrationKey(mallory, malloryStore);
    // Mallory derives grants from the same logs, but her wallet+key match
    // nothing: hydration fails closed with a typed error.
    const malloryFingerprint = sha256Hex(hexToBytesFlexible(malloryAttestation.message.rehydrationPublicKey));
    const malloryResolved = events
      .filter(
        (event): event is Extract<DecodedDocumentEvent, { eventName: 'SlotKeyGranted' }> =>
          event.eventName === 'SlotKeyGranted' && event.docHash === docHash,
      )
      .map((event) => ({
        slotId: event.slotId,
        recipient: event.recipient,
        recipientKeyFingerprint: malloryFingerprint,
        wrap: event.wrap,
      }));
    expect(() =>
      rehydrateGrantedDocument({
        artifact: resolved.bundle.artifact,
        encryptedSlots: resolved.bundle.encryptedSlots,
        grants: malloryResolved,
        recipientWallet: mallory.address,
        rehydrationKey: malloryKey,
      }),
    ).toThrow(expect.objectContaining({ code: 'UNAUTHORIZED_RECIPIENT' }));
    // And the redacted file she holds never contained the secrets in the
    // first place (asserted above on bundleJson).
  });
});
