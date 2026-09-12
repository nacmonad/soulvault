/**
 * IndexedDB persistence for the shared event cache. Events are immutable
 * facts (append-only, keyed by txHash:logIndex), so they can be rehydrated
 * across sessions/pages: a reload resumes from the persisted tail instead of
 * re-scanning full history against rate-limited public RPCs.
 *
 * BigInts are serialized as strings (IDB structured clone handles bigint,
 * but string keys keep the store simpler and JSON-debuggable). Scan-start
 * blocks are persisted alongside so the scanner can resume from the highest
 * scanned block per source.
 */
import type { Hex } from 'viem';

import type { SoulVaultEvent } from './types';
import { eventKey } from './watcher';

const DB_NAME = 'soulvault-events';
const DB_VERSION = 1;
const STORE_EVENTS = 'events';
const STORE_META = 'meta';
const MAX_PERSISTED_EVENTS = 5_000;

type PersistedEvent = {
  key: string;
  source: string;
  sourceKind: string;
  eventName: string;
  blockNumber: string; // bigint as string
  logIndex: number;
  txHash: Hex;
  /** Full event with bigints stringified — revived on load. */
  payload: unknown;
};

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null); // SSR / private mode — persistence unavailable
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          const store = db.createObjectStore(STORE_EVENTS, { keyPath: 'key' });
          store.createIndex('source', 'source');
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function stringifyBigints(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(stringifyBigints);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stringifyBigints(v)]));
  }
  return value;
}

/** Revive stringified bigints where the event type expects them. Block numbers
 * and uint args come back as strings; numeric args are best-effort revived. */
function reviveEvent(persisted: PersistedEvent): SoulVaultEvent | null {
  try {
    const payload = persisted.payload as Record<string, unknown>;
    const revived = reviveBigints(payload) as Record<string, unknown>;
    // Event-level known-bigint fields are short numbers — restore explicitly.
    if (typeof revived.blockNumber === 'string') revived.blockNumber = BigInt(revived.blockNumber);
    if (typeof revived.joinedEpoch === 'string') revived.joinedEpoch = BigInt(revived.joinedEpoch);
    if (typeof revived.agentId === 'string') revived.agentId = BigInt(revived.agentId);
    if (typeof revived.currentEpoch === 'string') revived.currentEpoch = BigInt(revived.currentEpoch);
    if (typeof revived.membershipVersion === 'string') revived.membershipVersion = BigInt(revived.membershipVersion);
    if (typeof revived.grantedAt === 'object' && revived.grantedAt !== null) {
      const ga = revived.grantedAt as Record<string, unknown>;
      if (typeof ga.blockNumber === 'string') ga.blockNumber = BigInt(ga.blockNumber);
    }
    if (typeof revived.registeredAt === 'object' && revived.registeredAt !== null) {
      const ra = revived.registeredAt as Record<string, unknown>;
      if (typeof ra.blockNumber === 'string') ra.blockNumber = BigInt(ra.blockNumber);
    }
    if (typeof revived.updatedAt === 'object' && revived.updatedAt !== null) {
      const ua = revived.updatedAt as Record<string, unknown>;
      if (typeof ua.blockNumber === 'string') ua.blockNumber = BigInt(ua.blockNumber);
    }
    return revived as unknown as SoulVaultEvent;
  } catch {
    return null;
  }
}

function reviveBigints(value: unknown): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value) && value.length > 15) {
    // Long digit strings are serialized bigints (short ones stay strings —
    // they are overwhelmingly hashes/addresses/text, and restoring a short
    // number as bigint would corrupt string-typed args).
    return BigInt(value);
  }
  if (Array.isArray(value)) return value.map(reviveBigints);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, reviveBigints(v)]));
  }
  return value;
}

/** Persist a merged batch (idempotent — same key = same immutable event). */
export async function persistEvents(events: readonly SoulVaultEvent[]): Promise<void> {
  const db = await openDb();
  if (!db || events.length === 0) return;
  try {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    for (const event of events) {
      const persisted: PersistedEvent = {
        key: eventKey(event),
        source: event.source,
        sourceKind: event.sourceKind,
        eventName: event.eventName,
        blockNumber: event.blockNumber.toString(),
        logIndex: event.logIndex,
        txHash: event.txHash,
        payload: stringifyBigints(event),
      };
      store.put(persisted);
    }
    // Bound the store: prune oldest (by block) when over the cap.
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const total = countRequest.result;
      if (total <= MAX_PERSISTED_EVENTS) return;
      const cursor = store.index('source').openCursor();
      const excess = total - MAX_PERSISTED_EVENTS;
      let seen = 0;
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        if (seen < excess) {
          c.delete();
          seen += 1;
        }
        c.continue();
      };
    };
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // persistence is best-effort
      tx.onabort = () => resolve();
    });
  } catch {
    // IndexedDB unavailable/quota-exceeded — memory cache still works.
  } finally {
    db.close();
  }
}

/** Load persisted events, oldest first (mergeEventBatches re-orders anyway). */
export async function loadPersistedEvents(): Promise<SoulVaultEvent[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE_EVENTS, 'readonly');
    const store = tx.objectStore(STORE_EVENTS);
    const all = await new Promise<PersistedEvent[]>((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result ?? []) as PersistedEvent[]);
      request.onerror = () => resolve([]);
    });
    const events = all
      .map(reviveEvent)
      .filter((event): event is SoulVaultEvent => event !== null);
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
      return a.logIndex - b.logIndex;
    });
    return events;
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Highest persisted block per source address (lowercase) — resume cursor. */
export async function loadPersistedScanHeads(): Promise<Record<string, bigint>> {
  const events = await loadPersistedEvents();
  const heads: Record<string, bigint> = {};
  for (const event of events) {
    const key = event.source.toLowerCase();
    if (!heads[key] || event.blockNumber > heads[key]) heads[key] = event.blockNumber;
  }
  return heads;
}

/** Drop the persisted cache (debug / settings "clear cache"). */
export async function clearPersistedEvents(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    tx.objectStore(STORE_EVENTS).clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  } finally {
    db.close();
  }
}

/** Remove every persisted event from the given source contracts (org switch —
 * the org slice of the cache must not leak the previous org's events). */
export async function deletePersistedEventsForSources(sources: readonly string[]): Promise<void> {
  const gone = new Set(sources.map((s) => s.toLowerCase()));
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_EVENTS, 'readwrite');
    const store = tx.objectStore(STORE_EVENTS);
    const all = await new Promise<PersistedEvent[]>((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve((request.result ?? []) as PersistedEvent[]);
      request.onerror = () => resolve([]);
    });
    for (const persisted of all) {
      if (gone.has(persisted.source.toLowerCase())) store.delete(persisted.key);
    }
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore
  } finally {
    db.close();
  }
}
