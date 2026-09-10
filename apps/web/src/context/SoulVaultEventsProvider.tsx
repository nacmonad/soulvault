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
import type { ActiveGrant, SoulVaultDeployment, SoulVaultEvent } from '@/lib/onchain/types';
import { mergeEventBatches, SoulVaultEventWatcher } from '@/lib/onchain/watcher';

export type SoulVaultEventsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SoulVaultEventsContextValue = {
  events: SoulVaultEvent[];
  status: SoulVaultEventsStatus;
  error: unknown;
  isLive: boolean;
  /** Chain the shared watcher scans (its single publicClient's chain). */
  chainId: number | null;
  refresh: () => Promise<void>;
  startLive: (pollSeconds?: number) => Promise<void>;
  stopLive: () => void;
  resolveGrants: (docHash: Hex, recipient: Address) => Promise<ActiveGrant[]>;
  /** Merge runtime-discovered sources (ENS) into the watcher; rescans once when new. */
  addSources: (sources: readonly SoulVaultDeployment[]) => Promise<boolean>;
};

export const SoulVaultEventsContext = createContext<SoulVaultEventsContextValue | null>(null);

const CONFIG_ERROR = 'SoulVault events config missing — set NEXT_PUBLIC_SOULVAULT_RPC_URL (or the settings override)';

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
        // Sources were added while the shared scan ran; loop for one fresh
        // scan now that it has settled.
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
      const added = sources
        .filter((source) => source.chainId === undefined || source.chainId === chainId)
        .some((source) => watcher.addSource(source));
      if (added) await refresh();
      return added;
    },
    [getWatcher, refresh],
  );

  /**
   * DocumentRegistry discovery (ENSIP-11 on the protocol root name) — merged
   * into the watcher so Overview/Documents, the events page, and grants see
   * DocumentPublished/SlotKeyGranted. Rescans once, only when the source is
   * genuinely new.
   */
  useEffect(() => {
    let cancelled = false;
    resolveDocumentEventSource()
      .then(async (source) => {
        if (cancelled || !source) return;
        try {
          await addSources([source]);
        } catch {
          // No RPC config — nothing to scan into; pages surface their own errors.
        }
      })
      .catch(() => {
        // Discovery failure (no record yet, RPC hiccup) — nothing to add.
      });
    return () => {
      cancelled = true;
    };
  }, [addSources]);

  /** Identity registry (built-in Sepolia constant / erc8004.registry record). */
  useEffect(() => {
    let cancelled = false;
    resolveIdentityEventSource()
      .then(async (source) => {
        if (cancelled || !source) return;
        try {
          await addSources([source]);
        } catch {
          // as above
        }
      })
      .catch(() => {
        // Discovery failure — identity events stay absent.
      });
    return () => {
      cancelled = true;
    };
  }, [addSources]);

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
      refresh,
      startLive,
      stopLive,
      resolveGrants,
      addSources,
    }),
    [state, isLive, refresh, startLive, stopLive, resolveGrants, addSources],
  );

  return <SoulVaultEventsContext.Provider value={value}>{children}</SoulVaultEventsContext.Provider>;
}

export function useSoulVaultEventsContext(): SoulVaultEventsContextValue {
  const ctx = useContext(SoulVaultEventsContext);
  if (!ctx) throw new Error('SoulVault events hooks require <SoulVaultEventsProvider> in the tree');
  return ctx;
}
