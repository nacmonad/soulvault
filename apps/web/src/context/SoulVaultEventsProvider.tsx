'use client';

/**
 * SoulVaultEventsProvider — dashboard-wide event state.
 *
 * Owns the watcher instance and the shared event cache; the per-kind hooks
 * (useSwarmEvents, useTreasuryEvents, useAgentEvents, useDocumentEvents) and
 * the catch-all useEvents read from this context and filter by contract kind.
 *
 * Nothing polls until a hook asks for it: `refresh` scans history once,
 * `startLive` begins cursor polling. Config comes from NEXT_PUBLIC_ env vars
 * unless a config object is passed explicitly.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Address, Hex } from 'viem';
import {
  createSoulVaultPublicClient,
  getBrowserSoulVaultClientConfig,
  type SoulVaultClientConfig,
} from '@/lib/onchain/client';
import type { ActiveGrant, SoulVaultEvent } from '@/lib/onchain/types';
import { mergeEventBatches, SoulVaultEventWatcher } from '@/lib/onchain/watcher';

export type SoulVaultEventsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type SoulVaultEventsContextValue = {
  events: SoulVaultEvent[];
  status: SoulVaultEventsStatus;
  error: unknown;
  isLive: boolean;
  refresh: () => Promise<void>;
  startLive: (pollSeconds?: number) => Promise<void>;
  stopLive: () => void;
  resolveGrants: (docHash: Hex, recipient: Address) => Promise<ActiveGrant[]>;
};

export const SoulVaultEventsContext = createContext<SoulVaultEventsContextValue | null>(null);

const CONFIG_ERROR = 'SoulVault events config missing — set NEXT_PUBLIC_SOULVAULT_RPC_URL and NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS';

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
  const [state, setState] = useState<{ events: SoulVaultEvent[]; status: SoulVaultEventsStatus; error: unknown }>({
    events: [],
    status: 'idle',
    error: null,
  });
  const [isLive, setIsLive] = useState(false);

  useEffect(() => () => stopRef.current?.(), []);

  const getWatcher = useCallback(() => {
    if (!watcherRef.current && resolvedConfig.current) {
      watcherRef.current = new SoulVaultEventWatcher({
        publicClient: createSoulVaultPublicClient(resolvedConfig.current),
        sources: resolvedConfig.current.deployments,
      });
    }
    return watcherRef.current;
  }, []);

  const refresh = useCallback(async () => {
    const watcher = getWatcher();
    if (!watcher) {
      setState({ events: [], status: 'error', error: new Error(CONFIG_ERROR) });
      return;
    }
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const events = await watcher.scanHistory();
      setState({ events, status: 'ready', error: null });
    } catch (error) {
      setState((s) => ({ ...s, status: 'error', error }));
    }
  }, [getWatcher]);

  const startLive = useCallback(
    async (pollSeconds?: number) => {
      const watcher = getWatcher();
      if (!watcher) {
        setState({ events: [], status: 'error', error: new Error(CONFIG_ERROR) });
        return;
      }
      if (stopRef.current) return;
      setIsLive(true);
      setState((s) => ({ ...s, status: 'loading', error: null }));
      try {
        const events = await watcher.scanHistory();
        setState({ events, status: 'ready', error: null });
      } catch (error) {
        setState((s) => ({ ...s, status: 'error', error }));
      }
      const latest = await watcher.latestBlock().catch(() => null);
      stopRef.current = watcher.watchLive({
        pollSeconds: pollSeconds ?? 5,
        fromBlock: latest === null ? undefined : latest + BigInt(1),
        onEvents: (batch) => setState((s) => ({ ...s, events: mergeEventBatches(s.events, batch) })),
        onError: (error) => setState((s) => ({ ...s, error })),
      });
    },
    [getWatcher],
  );

  const stopLive = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
    setIsLive(false);
  }, []);

  const resolveGrants = useCallback(
    async (docHash: Hex, recipient: Address) => {
      const watcher = getWatcher();
      if (!watcher) throw new Error(CONFIG_ERROR);
      return watcher.resolveGrants(docHash, recipient);
    },
    [getWatcher],
  );

  const value = useMemo<SoulVaultEventsContextValue>(
    () => ({ ...state, isLive, refresh, startLive, stopLive, resolveGrants }),
    [state, isLive, refresh, startLive, stopLive, resolveGrants],
  );

  return <SoulVaultEventsContext.Provider value={value}>{children}</SoulVaultEventsContext.Provider>;
}

export function useSoulVaultEventsContext(): SoulVaultEventsContextValue {
  const ctx = useContext(SoulVaultEventsContext);
  if (!ctx) throw new Error('SoulVault events hooks require <SoulVaultEventsProvider> in the tree');
  return ctx;
}
