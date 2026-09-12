/**
 * SoulVaultEventWatcher — browser-side event scanning for all SoulVault
 * contracts (document / swarm / treasury / identity).
 *
 * Mirrors the proven CLI architecture in packages/node/src/swarm-contract.ts
 * (merge sources, order by (blockNumber, logIndex) so same-tx event pairs like
 * FundRequestApproved → FundsReleased render in order) but rebuilt on viem with
 * constructor-injected dependencies so it is chain-agnostic and usable from
 * React contexts.
 */
import { decodeEventLog, type Address, type Hex, type Log, type PublicClient } from 'viem';
import { SECP_WRAP_ALGORITHM, type SecpWrappedKey } from '@soulvault/protocol';
import { SOULVAULT_EVENT_ABIS } from './abis';
import { getLogsChunked } from './soulvault-activity';
import { orderEvents, resolveActiveGrants } from './reducers';
import type {
  ActiveGrant,
  EventMeta,
  SoulVaultDeployment,
  SoulVaultDocumentEvent,
  SoulVaultEvent,
} from './types';

export { orderEvents } from './reducers';

export type WatchLiveOptions = {
  pollSeconds?: number;
  fromBlock?: bigint;
  onEvents?: (events: SoulVaultEvent[]) => void;
  onError?: (error: unknown) => void;
};

export type SoulVaultWatcherConfig = {
  publicClient: PublicClient;
  sources: readonly SoulVaultDeployment[];
};

/** Dedupe key for merged batches across scans (tx + log position is unique). */
export function eventKey(event: SoulVaultEvent): string {
  return `${event.txHash}:${event.logIndex}`;
}

/**
 * Narrow an event into a typed document event, or null if it is not one of
 * the three document events. Accepts already-typed document events too, so
 * it doubles as the UI-side narrowing helper.
 */
export function parseDocumentEvent(event: SoulVaultEvent): SoulVaultDocumentEvent | null {
  if (event.sourceKind !== 'document') return null;
  if (isDocumentEvent(event)) return event;
  return decodeDocumentEvent(event.eventName, event.args, event);
}

function isDocumentEvent(event: SoulVaultEvent): event is SoulVaultDocumentEvent {
  return (
    event.eventName === 'DocumentPublished' ||
    event.eventName === 'SlotKeyGranted' ||
    event.eventName === 'RehydrationRequested'
  );
}

/** Deduping merge for provider state: append a batch, keep global order. */
export function mergeEventBatches(
  previous: readonly SoulVaultEvent[],
  batch: readonly SoulVaultEvent[],
): SoulVaultEvent[] {
  const seen = new Set(previous.map(eventKey));
  return orderEvents([...previous, ...batch.filter((e) => !seen.has(eventKey(e)))]);
}

function decodeDocumentEvent(
  eventName: string,
  args: Record<string, unknown>,
  meta: EventMeta,
): SoulVaultDocumentEvent | null {
  switch (eventName) {
    case 'DocumentPublished':
      return {
        ...meta,
        eventName: 'DocumentPublished',
        docHash: args.docHash as Hex,
        author: args.author as Address,
        slotIds: (args.slotIds as string[]) ?? [],
      };
    case 'SlotKeyGranted': {
      const algorithm = args.algorithm as string;
      if (algorithm !== SECP_WRAP_ALGORITHM) {
        throw new Error(`unexpected slot wrap algorithm: ${algorithm}`);
      }
      return {
        ...meta,
        eventName: 'SlotKeyGranted',
        docHash: args.docHash as Hex,
        slotId: args.slotId as string,
        recipient: args.recipient as Address,
        wrap: {
          wrappedKey: args.wrappedKey as string,
          algorithm: SECP_WRAP_ALGORITHM,
          ephemeralPublicKey: args.ephemeralPublicKey as string,
          nonce: args.nonce as string,
        } satisfies SecpWrappedKey,
      };
    }
    case 'RehydrationRequested':
      return {
        ...meta,
        eventName: 'RehydrationRequested',
        docHash: args.docHash as Hex,
        recipient: args.recipient as Address,
        rehydrationPublicKey: args.rehydrationPublicKey as string,
      };
    default:
      return null;
  }
}

export class SoulVaultEventWatcher {
  private readonly publicClient: PublicClient;
  private readonly _sources: SoulVaultDeployment[];
  /** Live view — addSource() extends it for subsequent scans. */
  readonly sources: readonly SoulVaultDeployment[];

  constructor(config: SoulVaultWatcherConfig) {
    // Zero sources is valid: runtime discovery (ENS) populates sources after
    // mount via addSource(). Scans with no sources simply return nothing.
    this.publicClient = config.publicClient;
    this._sources = [...config.sources];
    this.sources = this._sources;
  }

  /**
   * Register a deployment discovered at runtime (e.g. the DocumentRegistry via
   * ENS, which cannot be a build-time env entry). Dedupes by address; returns
   * whether the source was new — callers rescan only when it was.
   */
  /**
   * Register a deployment discovered at runtime (e.g. the DocumentRegistry via
   * ENS, which cannot be a build-time env entry). Dedupes by address; returns
   * whether the source was new — callers rescan only when it was.
   */
  addSource(source: SoulVaultDeployment): boolean {
    const key = source.address.toLowerCase();
    if (this._sources.some((s) => s.address.toLowerCase() === key)) return false;
    this._sources.push(source);
    return true;
  }

  /**
   * Remove all sources matching `predicate` (e.g. the previous org's
   * swarm/treasury contracts when the org selection changes — addSource only
   * ever adds, so without this a switch left both orgs' contracts watched and
   * their events merged in the shared cache). Returns the removed sources so
   * callers can purge their cached events.
   */
  removeSourcesMatching(predicate: (source: SoulVaultDeployment) => boolean): SoulVaultDeployment[] {
    const removed: SoulVaultDeployment[] = [];
    for (let i = this._sources.length - 1; i >= 0; i--) {
      if (predicate(this._sources[i])) removed.push(this._sources.splice(i, 1)[0]);
    }
    return removed;
  }

  async latestBlock(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  /** Full scan to latest. Per-source `fromBlock` is the default start. */
  async scanHistory(fromBlock?: bigint): Promise<SoulVaultEvent[]> {
    return this.scanRange(fromBlock, 'latest');
  }

  private async scanRange(
    fromBlock: bigint | undefined,
    toBlock: bigint | 'latest',
  ): Promise<SoulVaultEvent[]> {
    const perSource = await Promise.all(
      this.sources.map(async (source) => {
        const requested = fromBlock ?? source.fromBlock;
        if (toBlock !== 'latest' && toBlock < source.fromBlock) return [];
        const from = requested < source.fromBlock ? source.fromBlock : requested;
        const logs = await getLogsChunked(this.publicClient, { address: source.address, fromBlock: from, toBlock });
        return logs
          .map((log) => this.decodeLog(log, source))
          .filter((event): event is SoulVaultEvent => event !== null);
      }),
    );
    return orderEvents(perSource.flat());
  }

  private decodeLog(log: Log, source: SoulVaultDeployment): SoulVaultEvent | null {
    if (log.blockNumber == null || log.transactionHash == null) return null;
    try {
      const decoded = decodeEventLog({
        abi: SOULVAULT_EVENT_ABIS[source.kind],
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName == null) return null;
      const args = (decoded.args ?? {}) as Record<string, unknown>;
      const meta = {
        source: source.address,
        sourceKind: source.kind,
        blockNumber: log.blockNumber,
        logIndex: log.logIndex ?? 0,
        txHash: log.transactionHash,
      };
      if (source.kind === 'document') {
        const docEvent = decodeDocumentEvent(decoded.eventName, args, meta);
        if (docEvent) return docEvent;
      }
      return { ...meta, eventName: decoded.eventName, args };
    } catch {
      // Unknown ABI drift on this log; skip it like the activity loader does.
      return null;
    }
  }

  /**
   * Active grants for (docHash, recipient), scanned from the document
   * sources. Semantics live in resolveActiveGrants (reducers.ts).
   */
  async resolveGrants(docHash: Hex, recipient: Address): Promise<ActiveGrant[]> {
    const docSources = this.sources.filter((s) => s.kind === 'document');
    if (docSources.length === 0) return [];
    const perSource = await Promise.all(
      docSources.map((source) => this.scanRange(source.fromBlock, 'latest')),
    );
    const target = docHash.toLowerCase();
    const docEvents = perSource
      .flat()
      .map(parseDocumentEvent)
      .filter((e): e is SoulVaultDocumentEvent => e !== null)
      .filter((e) => e.docHash.toLowerCase() === target);
    return resolveActiveGrants(docEvents, recipient);
  }

  /**
   * Cursor-based live polling (mirrors watchSwarmEvents). Returns a stop
   * function; safe to call repeatedly. Re-entrant ticks are skipped while a
   * fetch is in flight.
   */
  watchLive(options: WatchLiveOptions): () => void {
    const intervalMs = Math.max(2, options.pollSeconds ?? 5) * 1000;
    let inFlight = false;
    let cursor: bigint | null = null;

    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const latest = await this.publicClient.getBlockNumber();
        if (cursor === null) cursor = options.fromBlock ?? latest;
        if (latest >= cursor) {
          let events: SoulVaultEvent[];
          try {
            events = await this.scanRange(cursor, latest);
          } catch {
            // Load-balanced RPCs can report a head that another backend has not
            // caught up to: an explicit toBlock beyond the responding node's
            // head fails the whole getLogs. Retry once one block behind and
            // rewind the cursor to cover the boundary block next tick (the
            // merge dedupes the overlap).
            events = await this.scanRange(cursor, latest - BigInt(1));
            cursor = latest;
          }
          if (events.length > 0) options.onEvents?.(events);
          cursor = cursor > latest ? cursor : latest + BigInt(1);
        }
      } catch (error) {
        options.onError?.(error);
      } finally {
        inFlight = false;
      }
    };

    void tick();
    const interval = setInterval(() => void tick(), intervalMs);
    return () => clearInterval(interval);
  }
}
