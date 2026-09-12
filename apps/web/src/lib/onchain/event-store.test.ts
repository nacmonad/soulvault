import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';

import {
  clearPersistedEvents,
  deletePersistedEventsForSources,
  loadPersistedEvents,
  loadPersistedScanHeads,
  persistEvents,
} from './event-store';
import type { SoulVaultEvent } from './types';

/**
 * IndexedDB event persistence, run against fake-indexeddb (real IDB API,
 * in-memory). The store contract under test: keyed by txHash:logIndex,
 * bigint round-trip, per-source deletion.
 */

function makeEvent(overrides: { txHash: string; logIndex: number; blockNumber: bigint; source?: string; args?: Record<string, unknown> }): SoulVaultEvent {
  const { source, args, ...rest } = overrides;
  return {
    sourceKind: 'swarm',
    eventName: 'JoinApproved',
    args: args ?? { requestId: 1n, epoch: rest.blockNumber },
    source: source ?? '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ...rest,
  } as unknown as SoulVaultEvent;
}

beforeEach(async () => {
  await clearPersistedEvents();
});

describe('event-store persistence', () => {
  it('persists and reloads events with bigints intact', async () => {
    const event = makeEvent({ txHash: '0xabc', logIndex: 3, blockNumber: 123456789n });
    await persistEvents([event]);
    const loaded = await loadPersistedEvents();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].txHash).toBe('0xabc');
    expect(loaded[0].logIndex).toBe(3);
    expect(loaded[0].blockNumber).toBe(123456789n);
    expect(loaded[0].source).toBe('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('is idempotent — persisting the same txHash:logIndex twice stores one row', async () => {
    const event = makeEvent({ txHash: '0xabc', logIndex: 3, blockNumber: 1n });
    await persistEvents([event]);
    await persistEvents([event]);
    expect(await loadPersistedEvents()).toHaveLength(1);
  });

  it('revives long uint args as bigint while short strings stay strings', async () => {
    const event = makeEvent({
      txHash: '0xabc',
      logIndex: 1,
      blockNumber: 42n,
      args: { bigEpoch: 12345678901234567890n, requestId: '0xdeadbeef', short: '12345' },
    });
    await persistEvents([event]);
    const [loaded] = await loadPersistedEvents();
    const args = (loaded as unknown as { args: Record<string, unknown> }).args;
    expect(args.bigEpoch).toBe(12345678901234567890n);
    expect(args.requestId).toBe('0xdeadbeef'); // hex — untouched
    expect(args.short).toBe('12345'); // short digit string stays a string
  });

  it('deletePersistedEventsForSources drops only the named sources', async () => {
    const keep = makeEvent({ txHash: '0x1', logIndex: 0, blockNumber: 5n, source: '0x1111111111111111111111111111111111111111' });
    const drop = makeEvent({ txHash: '0x2', logIndex: 0, blockNumber: 6n, source: '0x2222222222222222222222222222222222222222' });
    await persistEvents([keep, drop]);
    await deletePersistedEventsForSources(['0x2222222222222222222222222222222222222222']);
    const loaded = await loadPersistedEvents();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].source.toLowerCase()).toBe('0x1111111111111111111111111111111111111111');
  });

  it('loadPersistedScanHeads returns the highest block per source', async () => {
    await persistEvents([
      makeEvent({ txHash: '0x1', logIndex: 0, blockNumber: 10n }),
      makeEvent({ txHash: '0x2', logIndex: 0, blockNumber: 20n }),
    ]);
    const heads = await loadPersistedScanHeads();
    expect(heads['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa']).toBe(20n);
  });
});
