'use client';

/**
 * SoulVaultEventsProvider — dashboard-wide event state.
 *
 * Owns the watcher instance and the shared event cache; the per-kind hooks
 * (useSwarmEvents, useTreasuryEvents, useAgentEvents, useDocumentEvents) and
 * the catch-all useEvents read from this context and filter by contract kind.
 *
 * Nothing polls until a hook asks for it: `refresh` scans history once,
 * `startLive` begins cursor polling. Transport comes from NEXT_PUBLIC_ env
 * vars (RPC + chain id); event sources are discovered at runtime — document
 * registry and identity registry on the protocol root name, swarm/treasury
 * from the selected org's ENS records (see OrgEventSourcesBridge) — and merged
 * into the watcher via addSources.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Address, Hex } from 'viem';
import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
  type SoulVaultClientConfig,
} from '@/lib/onchain/client';
import { resolveDocumentEventSource } from '@/lib/document-registry';
import { resolveIdentityEventSource } from '@/lib/identity-registry';
import { useSoulVaultWallet } from '@/components/providers/soulvault-ledger-provider';
import type { ActiveGrant, SoulVaultContractKind, SoulVaultDeployment, SoulVaultEvent } from '@/lib/onchain/types';
import { mergeEventBatches, SoulVaultEventWatcher } from '@/lib/onchain/watcher';

export type SoulVaultEventsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type WatchedSource = { address: string; kind: SoulVaultContractKind; label?: string };

export type SoulVaultEventsContextValue = {
  events: SoulVaultEvent[];
  status: SoulVaultEventsStatus;
  error: unknown;
  isLive: boolean;
  /** Chain the shared watcher scans (its single publicClient's chain). */
  chainId: number | null;
  /** Event sources currently registered on the watcher — surfaces runtime
   * discovery (ENS) in the UI so an empty page can be told apart from a
   * pipeline that never learned about the contract. */
  sources: readonly WatchedSource[];
  refresh: () => Promise<void>;
  startLive: (pollSeconds?: number) => Promise<void>;
  stopLive: () => void;
  resolveGrants: (docHash: Hex, recipient: Address) => Promise<ActiveGrant[]>;
  /** Merge runtime-discovered sources (ENS) into the watcher; rescans once when new. */
  addSources: (sources: readonly SoulVaultDeployment[]) => Promise<boolean>;
  /** Org-scoped source replacement: removes ALL swarm/treasury sources (they
   * are always org-derived), purges their events from the shared cache, adds
   * the new org's sources, and rescans. Keeps document/identity sources. */
  replaceOrgSources: (sources: readonly SoulVaultDeployment[]) => Promise<void>;
};

export const SoulVaultEventsContext = createContext<SoulVaultEventsContextValue | null>(null);

const CONFIG_ERROR = 'SoulVault events config missing — set NEXT_PUBLIC_SOULVAULT_RPC_URL (or the settings override)';

/** Retries for initial runtime discovery (transient ENS/RPC failures). */
const DISCOVERY_RETRIES = 4;
const DISCOVERY_RETRY_MS = 3000;
/** Re-resolve cadence: ENS announcements can land after mount (fresh registry
 * deploy/announce from another tab or the CLI), and the record can point at a
 * newly redeployed contract. addSources dedupes unchanged addresses, so an
 * unchanged resolution costs one ENS read and no rescan. */
const DISCOVERY_RECHECK_MS = 60_000;

/**
 * Runtime-discovered event sources (ENS) need the same treatment as the org
 * bridge: retry transient failures instead of silently staying absent, and
 * keep re-resolving so a re-announced contract is picked up without a page
 * reload. The one-shot version of this effect is why a freshly redeployed
 * DocumentRegistry stayed invisible to the events pipeline until reload.
 */
function useDiscoveredEventSource(
  resolve: () => Promise<SoulVaultDeployment | null>,
  addSources: (sources: readonly SoulVaultDeployment[]) => Promise<boolean>,
) {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (retriesLeft: number): Promise<void> => {
      let source: SoulVaultDeployment | null = null;
      try {
        source = await resolve();
      } catch {
        source = null;
      }
      if (cancelled) return;
      if (!source && retriesLeft > 0) {
        timer = setTimeout(() => void run(retriesLeft - 1), DISCOVERY_RETRY_MS);
        return;
      }
      if (source) {
        try {
          await addSources([source]);
        } catch {
          // No RPC config — nothing to scan into; pages surface their own errors.
        }
      }
      if (cancelled) return;
      timer = setTimeout(() => void run(0), DISCOVERY_RECHECK_MS);
    };
    void run(DISCOVERY_RETRIES);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [resolve, addSources]);
}

export function SoulVaultEventsProvider({
  children,
  config,
}: {
  children: ReactNode;
  config?: SoulVaultClientConfig;
}) {
  const resolvedConfig = useRef<SoulVaultClientConfig | null>(config ?? getBrowserSoulVaultClientConfig());
  const watcherRef = useRef<SoulVaultEventWatcher | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  /** Monotonic scan id — only the newest-started scan may write state.
   * Concurrent scans (initial mount + ENS-discovered sources arriving from the
   * bridge/registry effects) would otherwise race last-writer-wins, and a scan
   * that started before a source was added would wipe already-scanned events. */
  const scanSeq = useRef(0);
  /** Shared in-flight history scan — multiple mount-time triggers (registry
   * effects, bridge, page startLive) would otherwise each run a full scanHistory
   * concurrently, multiplying RPC load on rate-limited public nodes.
   * sourceCount is captured at scan start: sources added mid-scan are not in
   * its snapshot, so joiners re-scan once after it settles. */
  const inFlightScanRef = useRef<{ promise: Promise<SoulVaultEvent[]>; sourceCount: number } | null>(null);
  const [state, setState] = useState<{ events: SoulVaultEvent[]; status: SoulVaultEventsStatus; error: unknown }>({
    events: [],
    status: 'idle',
    error: null,
  });
  const [isLive, setIsLive] = useState(false);

  useEffect(() => () => stopRef.current?.(), []);

  const getWatcher = useCallback(() => {
    const config = resolvedConfig.current;
    if (!config) return null;
    if (!watcherRef.current) {
      // Zero sources is fine — runtime discovery (ENS) adds them after mount.
      watcherRef.current = new SoulVaultEventWatcher({
        publicClient: createSoulVaultPublicClient(config),
        sources: config.deployments,
      });
    }
    return watcherRef.current;
  }, []);

  const runScan = useCallback(async () => {
    const watcher = getWatcher();
    if (!watcher) {
      setState({ events: [], status: 'error', error: new Error(CONFIG_ERROR) });
      return;
    }
    const seq = ++scanSeq.current;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      for (;;) {
        const inFlight = inFlightScanRef.current;
        if (!inFlight) {
          const promise = watcher.scanHistory();
          inFlightScanRef.current = { promise, sourceCount: watcher.sources.length };
          const settle = () => {
            if (inFlightScanRef.current?.promise === promise) inFlightScanRef.current = null;
          };
          promise.then(settle, settle);
          const events = await promise;
          // A newer scan (started after this one) supersedes this snapshot.
          if (seq !== scanSeq.current) return;
          setState({ events, status: 'ready', error: null });
          return;
        }
        // Join the shared scan instead of starting a duplicate.
        const events = await inFlight.promise;
        if (seq !== scanSeq.current) return;
        if (watcher.sources.length === inFlight.sourceCount) {
          setState({ events, status: 'ready', error: null });
          return;
        }
        // Sources were added while the shared scan ran. Give any other
        // in-flight discovery (registry effects, ENS bridge) a moment to land
        // too, so the fresh scan includes them instead of chaining re-scans.
        await new Promise((resolve) => setTimeout(resolve, 750));
        if (seq !== scanSeq.current) return;
        // Sources were added while the shared scan was running; loop for one
        // fresh scan now that it has settled.
      }
    } catch (error) {
      if (seq !== scanSeq.current) return;
      setState((s) => ({ ...s, status: 'error', error }));
    }
  }, [getWatcher]);

  const refresh = useCallback(() => runScan(), [runScan]);

  const startLive = useCallback(
    async (pollSeconds?: number) => {
      const watcher = getWatcher();
      if (!watcher) {
        setState({ events: [], status: 'error', error: new Error(CONFIG_ERROR) });
        return;
      }
      if (stopRef.current) return;
      setIsLive(true);
      await runScan();
      const latest = await watcher.latestBlock().catch(() => null);
      stopRef.current = watcher.watchLive({
        pollSeconds: pollSeconds ?? 5,
        fromBlock: latest === null ? undefined : latest + BigInt(1),
        onEvents: (batch) => setState((s) => ({ ...s, events: mergeEventBatches(s.events, batch) })),
        onError: (error) => setState((s) => ({ ...s, error })),
      });
    },
    [getWatcher, runScan],
  );

  const stopLive = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setIsLive(false);
  }, []);

  const addSources = useCallback(
    async (sources: readonly SoulVaultDeployment[]) => {
      const watcher = getWatcher();
      if (!watcher) throw new Error(CONFIG_ERROR);
      const chainId = resolvedConfig.current?.chainId;
      // One watcher per chain today: drop sources announced for other chains
      // (multi-chain watchers are the extension point).
      // NB: add every source — never .some() here, it short-circuits and used to
      // silently drop every source after the first new one (the org's swarm was
      // lost whenever a treasury was added in the same batch).
      let added = false;
      for (const source of sources) {
        if (source.chainId !== undefined && source.chainId !== chainId) continue;
        if (watcher.addSource(source)) added = true;
      }
      if (added) await refresh();
      return added;
    },
    [getWatcher, refresh],
  );

  /**
   * Org switch semantics: the bridge previously called addSources on every org
   * change, which only ever added — the previous org's swarm/treasury sources
   * stayed registered (their events kept flowing) and the shared cache kept
   * their events, so the page showed a stale union of both orgs. This replaces
   * the whole org-scoped slice: remove old, purge cache, add new, rescan.
   */
  const replaceOrgSources = useCallback(
    async (sources: readonly SoulVaultDeployment[]) => {
      const watcher = getWatcher();
      if (!watcher) throw new Error(CONFIG_ERROR);
      const removed = watcher.removeSourcesMatching((s) => s.kind === 'swarm' || s.kind === 'treasury');
      if (removed.length > 0) {
        const gone = new Set(removed.map((s) => s.address.toLowerCase()));
        setState((s) => ({ ...s, events: s.events.filter((e) => !gone.has(e.source.toLowerCase())) }));
      }
      await addSources(sources);
      if (removed.length > 0) {
        // Old org's sources gone: force a rescan even when the new org added
        // nothing new, so status settles on the reduced source set.
        await refresh();
      }
    },
    [getWatcher, refresh, addSources],
  );

  /**
   * DocumentRegistry discovery (ENSIP-11 on the protocol root name) — merged
   * into the watcher so Overview/Documents, the events page, and grants see
   * DocumentPublished/SlotKeyGranted. Retried and periodically re-resolved
   * (see useDiscoveredEventSource) so a fresh deploy/announce is picked up.
   * viewer = connected wallet: pure-v2 org root names are only discoverable
   * via the ENSv2 CREATE2 recompute, which is viewer-bound. Re-resolved when
   * the wallet (re)connects.
   */
  const { address: viewer } = useSoulVaultWallet();
  const resolveDocumentSource = useCallback(
    () => resolveDocumentEventSource({ viewer: viewer ?? undefined }),
    [viewer],
  );
  const resolveIdentitySource = useCallback(
    () => resolveIdentityEventSource({ viewer: viewer ?? undefined }),
    [viewer],
  );
  useDiscoveredEventSource(resolveDocumentSource, addSources);

  /** Identity registry (built-in Sepolia constant / erc8004.registry record). */
  useDiscoveredEventSource(resolveIdentitySource, addSources);

  const resolveGrants = useCallback(
    async (docHash: Hex, recipient: Address) => {
      const watcher = getWatcher();
      if (!watcher) throw new Error(CONFIG_ERROR);
      return watcher.resolveGrants(docHash, recipient);
    },
    [getWatcher],
  );

  const value = useMemo<SoulVaultEventsContextValue>(
    () => ({
      ...state,
      isLive,
      chainId: resolvedConfig.current?.chainId ?? null,
      // Read at value-computation time: addSources → refresh → state change
      // recomputes this, so the UI sees discovery land.
      sources: (watcherRef.current?.sources ?? []).map(({ address, kind, label }) => ({ address, kind, label })),
      refresh,
      startLive,
      stopLive,
      resolveGrants,
      addSources,
      replaceOrgSources,
    }),
    [state, isLive, refresh, startLive, stopLive, resolveGrants, addSources, replaceOrgSources],
  );

  return <SoulVaultEventsContext.Provider value={value}>{children}</SoulVaultEventsContext.Provider>;
}

export function useSoulVaultEventsContext(): SoulVaultEventsContextValue {
  const ctx = useContext(SoulVaultEventsContext);
  if (!ctx) throw new Error('SoulVault events hooks require <SoulVaultEventsProvider> in the tree');
  return ctx;
}
