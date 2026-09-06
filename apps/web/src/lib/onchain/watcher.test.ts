/**
 * Unit tests for the browser event layer.
 *
 * Strategy: build raw logs with viem's own encodeEventLog against the same
 * parseAbi fragments the watcher decodes with, so every fixture exercises the
 * real ABI path (topic ordering, data layout) rather than hand-written hex.
 * The viem PublicClient is mocked — the watcher is constructor-injected, so
 * no chain or network is needed.
 */
import { describe, expect, it, vi } from 'vitest';
import { type Address, type Hex, type Log, type PublicClient } from 'viem';
import { SECP_WRAP_ALGORITHM } from '@soulvault/protocol';
import { mergeEventBatches, parseDocumentEvent, SoulVaultEventWatcher, type SoulVaultWatcherConfig } from './watcher';
import { ALICE, BOB, CHARLIE, DOC_ADDRESS, DOC_HASH, HASH, IDENTITY_ADDRESS, makeRawLog, SWARM, TREASURY, TREASURY_ADDRESS } from './test-utils';
import type { SoulVaultDeployment, SoulVaultContractKind, SoulVaultEvent } from './types';

// --- fixtures ---------------------------------------------------------------

const SOURCES: SoulVaultDeployment[] = [
  { address: DOC_ADDRESS, kind: 'document', fromBlock: 0n },
  { address: SWARM, kind: 'swarm', fromBlock: 0n },
  { address: TREASURY_ADDRESS, kind: 'treasury', fromBlock: 0n },
  { address: IDENTITY_ADDRESS, kind: 'identity', fromBlock: 0n },
];

function mockClient(logs: Log[], latest = 100n) {
  const getLogs = vi.fn(
    async (args: { address: Address; fromBlock: bigint; toBlock: bigint | 'latest' }) =>
      logs.filter(
        (l) =>
          l.address.toLowerCase() === args.address.toLowerCase() &&
          l.blockNumber! >= args.fromBlock &&
          (args.toBlock === 'latest' || l.blockNumber! <= args.toBlock),
      ),
  );
  const getBlockNumber = vi.fn(async () => latest);
  return {
    client: { getLogs, getBlockNumber } as unknown as PublicClient,
    getLogs,
    getBlockNumber,
    setLatest: (block: bigint) => {
      latest = block;
    },
  };
}

function makeWatcher(logs: Log[], latest?: bigint, sources = SOURCES) {
  const mock = mockClient(logs, latest);
  const config: SoulVaultWatcherConfig = { publicClient: mock.client, sources };
  return { watcher: new SoulVaultEventWatcher(config), ...mock };
}

// --- per-event catalog -------------------------------------------------------

const FIXTURES: Array<{ kind: SoulVaultContractKind; address: Address; eventName: string; args: Record<string, unknown> }> = [
  { kind: 'document', address: DOC_ADDRESS, eventName: 'DocumentPublished', args: { docHash: DOC_HASH, author: ALICE, slotIds: ['sv_name_1', 'sv_salary_1'] } },
  { kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted', args: { docHash: DOC_HASH, slotId: 'sv_salary_1', recipient: CHARLIE, wrappedKey: 'AAECAw==', algorithm: SECP_WRAP_ALGORITHM, ephemeralPublicKey: '04' + 'ee'.repeat(32), nonce: '11'.repeat(12) } },
  // swarm (19) — membership, epochs, backups, messaging, funds
  { kind: 'swarm', address: SWARM, eventName: 'JoinRequested', args: { requestId: 1n, requester: ALICE, pubkey: '0x1234', pubkeyRef: 'k.json', metadataRef: 'm.json' } },
  { kind: 'swarm', address: SWARM, eventName: 'JoinApproved', args: { requestId: 1n, requester: ALICE, approver: BOB, epoch: 3n } },
  { kind: 'swarm', address: SWARM, eventName: 'JoinRejected', args: { requestId: 1n, requester: ALICE, rejector: BOB, reason: 'no' } },
  { kind: 'swarm', address: SWARM, eventName: 'JoinCancelled', args: { requestId: 1n, requester: ALICE } },
  { kind: 'swarm', address: SWARM, eventName: 'MemberRemoved', args: { member: ALICE, by: BOB, epoch: 3n } },
  { kind: 'swarm', address: SWARM, eventName: 'EpochRotated', args: { oldEpoch: 2n, newEpoch: 3n, keyBundleRef: 'kb.json', keyBundleHash: HASH('01'), membershipVersion: 4n } },
  { kind: 'swarm', address: SWARM, eventName: 'MemberFileMappingUpdated', args: { member: ALICE, epoch: 3n, storageLocator: '0g://x', merkleRoot: HASH('02'), publishTxHash: HASH('03'), manifestHash: HASH('04'), by: BOB } },
  { kind: 'swarm', address: SWARM, eventName: 'AgentMessagePosted', args: { from: ALICE, to: BOB, topic: 'ops', seq: 1n, epoch: 3n, payloadRef: 'p.json', payloadHash: HASH('05'), ttl: 60n, timestamp: 1234n } },
  { kind: 'swarm', address: SWARM, eventName: 'AgentManifestUpdated', args: { agent: ALICE, manifestRef: 'mf.json', manifestHash: HASH('06'), timestamp: 1234n } },
  { kind: 'swarm', address: SWARM, eventName: 'BackupRequested', args: { requestedBy: ALICE, epoch: 3n, reason: 'drill', targetRef: 'b.json', deadline: 999n, timestamp: 1234n } },
  { kind: 'swarm', address: SWARM, eventName: 'HistoricalKeyBundleGranted', args: { member: ALICE, epoch: 3n, keyBundleRef: 'kb.json', keyBundleHash: HASH('06'), by: BOB } },
  { kind: 'swarm', address: SWARM, eventName: 'RekeyRequested', args: { trigger: 'join', membershipVersion: 4n } },
  { kind: 'swarm', address: SWARM, eventName: 'Paused', args: { by: BOB } },
  { kind: 'swarm', address: SWARM, eventName: 'Unpaused', args: { by: BOB } },
  { kind: 'swarm', address: SWARM, eventName: 'TreasurySet', args: { oldTreasury: BOB, newTreasury: TREASURY, by: BOB } },
  { kind: 'swarm', address: SWARM, eventName: 'FundRequested', args: { requestId: 1n, requester: ALICE, amount: 100n, reason: 'compute' } },
  { kind: 'swarm', address: SWARM, eventName: 'FundRequestApproved', args: { requestId: 1n, requester: ALICE, treasury: TREASURY, amount: 100n } },
  { kind: 'swarm', address: SWARM, eventName: 'FundRequestRejected', args: { requestId: 1n, requester: ALICE, treasury: TREASURY, reason: 'no' } },
  { kind: 'swarm', address: SWARM, eventName: 'FundRequestCancelled', args: { requestId: 1n, requester: ALICE } },
  // treasury (4)
  { kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsDeposited', args: { from: ALICE, amount: 1000n } },
  { kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsReleased', args: { swarm: SWARM, requestId: 1n, recipient: ALICE, amount: 100n } },
  { kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundRequestRejectedByTreasury', args: { swarm: SWARM, requestId: 1n, reason: 'no' } },
  { kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'TreasuryWithdrawn', args: { to: ALICE, amount: 500n } },
  // identity (3)
  { kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://a.example' } },
  { kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentURIUpdated', args: { agentId: 1n, agentWallet: ALICE, agentURI: 'https://b.example' } },
  { kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentMetadataSet', args: { agentId: 1n, key: 'name', value: 'bot' } },
];

describe('decode roundtrip — every event in the catalog', () => {
  it('decodes all fixtures through the real ABI path with matching kind and metadata', async () => {
    const logs = FIXTURES.map((f, i) => makeRawLog({ ...f, blockNumber: BigInt(10 + i), logIndex: 0 }));
    const { watcher } = makeWatcher(logs);
    const events = await watcher.scanHistory();

    expect(events).toHaveLength(FIXTURES.length);
    for (const fixture of FIXTURES) {
      const decoded = events.find((e) => e.eventName === fixture.eventName);
      expect(decoded, fixture.eventName).toBeDefined();
      expect(decoded!.sourceKind).toBe(fixture.kind);
      expect(decoded?.source).toBe(fixture.address);
    }
  });

  it('preserves block ordering and log position', async () => {
    const logs = [
      makeRawLog({ kind: 'swarm', address: SWARM, eventName: 'JoinRequested', args: FIXTURES.find((f) => f.eventName === 'JoinRequested')!.args, blockNumber: 5n, logIndex: 2 }),
      makeRawLog({ kind: 'swarm', address: SWARM, eventName: 'JoinApproved', args: FIXTURES.find((f) => f.eventName === 'JoinApproved')!.args, blockNumber: 4n, logIndex: 0 }),
      makeRawLog({ kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsReleased', args: FIXTURES.find((f) => f.eventName === 'FundsReleased')!.args, blockNumber: 5n, logIndex: 0 }),
    ];
    const { watcher } = makeWatcher(logs);
    const events = await watcher.scanHistory();
    // (blockNumber, logIndex) order: JoinApproved(4,0), FundsReleased(5,0), JoinRequested(5,2)
    expect(events.map((e) => e.eventName)).toEqual(['JoinApproved', 'FundsReleased', 'JoinRequested']);
  });

  it('decodes SlotKeyGranted into a typed SecpWrappedKey grant', async () => {
    const { watcher } = makeWatcher([
      makeRawLog({ kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted', args: FIXTURES.find((f) => f.eventName === 'SlotKeyGranted')!.args, blockNumber: 1n, logIndex: 0 }),
    ]);
    const events = await watcher.scanHistory();
    const grant = parseDocumentEvent(events[0]);
    expect(grant?.eventName).toBe('SlotKeyGranted');
    if (grant?.eventName !== 'SlotKeyGranted') return;
    expect(grant.docHash).toBe(DOC_HASH);
    expect(grant.slotId).toBe('sv_salary_1');
    expect(grant.recipient).toBe(CHARLIE);
    expect(grant.wrap).toEqual({
      wrappedKey: 'AAECAw==',
      algorithm: SECP_WRAP_ALGORITHM,
      ephemeralPublicKey: '04' + 'ee'.repeat(32),
      nonce: '11'.repeat(12),
    });
  });

  it('decodes DocumentPublished with slot list', async () => {
    const { watcher } = makeWatcher([
      makeRawLog({ kind: 'document', address: DOC_ADDRESS, eventName: 'DocumentPublished', args: FIXTURES.find((f) => f.eventName === 'DocumentPublished')!.args, blockNumber: 1n, logIndex: 0 }),
    ]);
    const events = await watcher.scanHistory();
    const published = parseDocumentEvent(events[0]);
    expect(published?.eventName).toBe('DocumentPublished');
    if (published?.eventName !== 'DocumentPublished') return;
    expect(published.author).toBe(ALICE);
    expect(published.slotIds).toEqual(['sv_name_1', 'sv_salary_1']);
  });

  it('skips undecodable logs instead of throwing', async () => {
    const good = makeRawLog({ kind: 'identity', address: IDENTITY_ADDRESS, eventName: 'AgentRegistered', args: FIXTURES.find((f) => f.eventName === 'AgentRegistered')!.args, blockNumber: 1n, logIndex: 0 });
    const garbage = { address: IDENTITY_ADDRESS, topics: [HASH('ff')], data: '0x' as Hex, blockNumber: 2n, logIndex: 0, transactionHash: HASH('ab'), removed: false } as unknown as Log;
    const { watcher } = makeWatcher([garbage, good]);
    const events = await watcher.scanHistory();
    expect(events.map((e) => e.eventName)).toEqual(['AgentRegistered']);
  });

  it('rejects grant wraps with a foreign algorithm (silent skip, surfaced by absence)', async () => {
    const { watcher } = makeWatcher([
      makeRawLog({ kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted', args: { ...FIXTURES.find((f) => f.eventName === 'SlotKeyGranted')!.args, algorithm: 'x25519-xsalsa20-poly1305' }, blockNumber: 1n, logIndex: 0 }),
    ]);
    const events = await watcher.scanHistory();
    expect(events).toHaveLength(0);
  });
});

// --- ordering / merging -------------------------------------------------------

describe('orderEvents / mergeEventBatches', () => {
  it('orders by (blockNumber, logIndex) across sources — same-tx pair stays in order', async () => {
    const logs = [
      makeRawLog({ kind: 'swarm', address: SWARM, eventName: 'FundRequestApproved', args: FIXTURES.find((f) => f.eventName === 'FundRequestApproved')!.args, blockNumber: 7n, logIndex: 1 }),
      makeRawLog({ kind: 'treasury', address: TREASURY_ADDRESS, eventName: 'FundsReleased', args: FIXTURES.find((f) => f.eventName === 'FundsReleased')!.args, blockNumber: 7n, logIndex: 2 }),
    ];
    const { watcher } = makeWatcher(logs);
    const events = await watcher.scanHistory();
    expect(events.map((e) => e.eventName)).toEqual(['FundRequestApproved', 'FundsReleased']);
  });

  it('mergeEventBatches dedupes by (txHash, logIndex) and keeps global order', async () => {
    const logs = [
      makeRawLog({ kind: 'swarm', address: SWARM, eventName: 'JoinRequested', args: FIXTURES.find((f) => f.eventName === 'JoinRequested')!.args, blockNumber: 1n, logIndex: 0 }),
      makeRawLog({ kind: 'swarm', address: SWARM, eventName: 'JoinApproved', args: FIXTURES.find((f) => f.eventName === 'JoinApproved')!.args, blockNumber: 2n, logIndex: 0, txHash: HASH('cd') }),
    ];
    const { watcher } = makeWatcher(logs);
    const events = await watcher.scanHistory();
    const [a, b] = events;
    const merged = mergeEventBatches([a], [a, b]);
    expect(merged).toHaveLength(2);
    expect(merged.map((e) => e.eventName)).toEqual(['JoinRequested', 'JoinApproved']);
  });
});

// --- resolveGrants ------------------------------------------------------------

describe('resolveGrants', () => {
  const grant = (slotId: string, blockNumber: bigint, overrides: Record<string, unknown> = {}) =>
    makeRawLog({
      kind: 'document',
      address: DOC_ADDRESS,
      eventName: 'SlotKeyGranted',
      args: { docHash: DOC_HASH, slotId, recipient: CHARLIE, wrappedKey: 'AAECAw==', algorithm: SECP_WRAP_ALGORITHM, ephemeralPublicKey: '04' + 'ee'.repeat(32), nonce: '11'.repeat(12), ...overrides },
      blockNumber,
      logIndex: 0,
    });

  it('returns active grants for the recipient and docHash', async () => {
    const { watcher } = makeWatcher([grant('sv_a_1', 1n), grant('sv_b_1', 2n)]);
    const grants = await watcher.resolveGrants(DOC_HASH, CHARLIE);
    expect(grants.map((g) => g.slotId).sort()).toEqual(['sv_a_1', 'sv_b_1']);
  });

  it('filters by recipient', async () => {
    const { watcher } = makeWatcher([grant('sv_a_1', 1n, { recipient: BOB })]);
    expect(await watcher.resolveGrants(DOC_HASH, CHARLIE)).toHaveLength(0);
    expect((await watcher.resolveGrants(DOC_HASH, BOB)).map((g) => g.slotId)).toEqual(['sv_a_1']);
  });

  it('filters by docHash', async () => {
    const { watcher } = makeWatcher([grant('sv_a_1', 1n)]);
    const other = HASH('bb') as Hex;
    expect(await watcher.resolveGrants(other, CHARLIE)).toHaveLength(0);
  });

  it('last grant wins per slot and carries the newest wrap', async () => {
    const { watcher } = makeWatcher([
      grant('sv_a_1', 1n, { wrappedKey: 'first==' }),
      grant('sv_a_1', 2n, { wrappedKey: 'second==' }),
    ]);
    const grants = await watcher.resolveGrants(DOC_HASH, CHARLIE);
    expect(grants).toHaveLength(1);
    expect(grants[0].wrap.wrappedKey).toBe('second==');
    expect(grants[0].grantedAt.blockNumber).toBe(2n);
  });



  it('returns empty (not throwing) when no document source is configured', async () => {
    const { watcher } = makeWatcher([], undefined, [SOURCES[1], SOURCES[2], SOURCES[3]]);
    expect(await watcher.resolveGrants(DOC_HASH, CHARLIE)).toEqual([]);
  });
});

// --- history scan bounds ------------------------------------------------------

describe('scanHistory bounds', () => {
  it('clamps requested fromBlock up to the source deployment block', async () => {
    const sources: SoulVaultDeployment[] = [{ address: DOC_ADDRESS, kind: 'document', fromBlock: 5n }];
    const { watcher, getLogs } = makeWatcher([], undefined, sources);
    await watcher.scanHistory(1n);
    expect(getLogs.mock.calls[0][0].fromBlock).toBe(5n);
  });

  it('uses the source deployment block when no fromBlock is given', async () => {
    const sources: SoulVaultDeployment[] = [{ address: DOC_ADDRESS, kind: 'document', fromBlock: 7n }];
    const { watcher, getLogs } = makeWatcher([], undefined, sources);
    await watcher.scanHistory();
    expect(getLogs.mock.calls[0][0].fromBlock).toBe(7n);
  });
});

// --- watchLive ------------------------------------------------------------------

describe('watchLive', () => {
  const baseLog = () =>
    makeRawLog({
      kind: 'document',
      address: DOC_ADDRESS,
      eventName: 'DocumentPublished',
      args: FIXTURES.find((f) => f.eventName === 'DocumentPublished')!.args,
      blockNumber: 10n,
      logIndex: 0,
    });

  it('emits ordered batches per poll and stops cleanly', async () => {
    vi.useFakeTimers();
    try {
      let latest = 10n;
      const logs: Log[] = [baseLog()];
      const client = {
        getBlockNumber: async () => latest,
        getLogs: async (args: { address: Address; fromBlock: bigint; toBlock: bigint | 'latest' }) =>
          logs.filter((l) => l.address === args.address && l.blockNumber! >= args.fromBlock && (args.toBlock === 'latest' || l.blockNumber! <= args.toBlock)),
      };
      const watcher = new SoulVaultEventWatcher({
        publicClient: client as unknown as PublicClient,
        sources: [{ address: DOC_ADDRESS, kind: 'document', fromBlock: 0n }],
      });
      const batches: string[][] = [];
      const stop = watcher.watchLive({
        pollSeconds: 2,
        onEvents: (batch) => batches.push(batch.map((e) => e.eventName)),
      });

      await vi.advanceTimersByTimeAsync(0); // first tick
      expect(batches).toEqual([['DocumentPublished']]);

      logs.push(makeRawLog({ kind: 'document', address: DOC_ADDRESS, eventName: 'SlotKeyGranted', args: { docHash: DOC_HASH, slotId: 'sv_salary_1', recipient: CHARLIE, wrappedKey: 'AAECAw==', algorithm: SECP_WRAP_ALGORITHM, ephemeralPublicKey: '04' + 'ee'.repeat(32), nonce: '11'.repeat(12) }, blockNumber: 12n, logIndex: 0 }));
      latest = 12n;
      await vi.advanceTimersByTimeAsync(2000); // second tick
      expect(batches).toEqual([['DocumentPublished'], ['SlotKeyGranted']]);

      stop();
      await vi.advanceTimersByTimeAsync(6000);
      expect(batches).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects an explicit fromBlock (does not replay older history)', async () => {
    vi.useFakeTimers();
    try {
      const logs: Log[] = [baseLog()];
      const latest = 10n;
      const client = {
        getBlockNumber: async () => latest,
        getLogs: async (args: { address: Address; fromBlock: bigint; toBlock: bigint | 'latest' }) =>
          logs.filter((l) => l.blockNumber! >= args.fromBlock && (args.toBlock === 'latest' || l.blockNumber! <= args.toBlock)),
      };
      const watcher = new SoulVaultEventWatcher({
        publicClient: client as unknown as PublicClient,
        sources: [{ address: DOC_ADDRESS, kind: 'document', fromBlock: 0n }],
      });
      const batches: SoulVaultEvent[][] = [];
      const stop = watcher.watchLive({ pollSeconds: 2, fromBlock: 11n, onEvents: (b) => batches.push(b) });
      await vi.advanceTimersByTimeAsync(0);
      expect(batches).toHaveLength(0); // block 10 < fromBlock 11
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports errors through onError instead of throwing', async () => {
    vi.useFakeTimers();
    try {
      const client = {
        getBlockNumber: async () => {
          throw new Error('rpc down');
        },
        getLogs: async () => [],
      };
      const watcher = new SoulVaultEventWatcher({
        publicClient: client as unknown as PublicClient,
        sources: [{ address: DOC_ADDRESS, kind: 'document', fromBlock: 0n }],
      });
      const errors: unknown[] = [];
      const stop = watcher.watchLive({ pollSeconds: 2, onError: (e) => errors.push(e) });
      await vi.advanceTimersByTimeAsync(0);
      expect(errors).toHaveLength(1);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
