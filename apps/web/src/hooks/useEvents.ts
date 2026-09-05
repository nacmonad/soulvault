'use client';

/**
 * Catch-all event hook: returns every SoulVault event in the shared cache.
 * The specialized hooks (useSwarmEvents, useTreasuryEvents, useAgentEvents,
 * useDocumentEvents) are thin kind-filters over this one.
 *
 * First call triggers a history scan unless the caller opted into `live`
 * (which scans history itself, then starts cursor polling).
 */
import { useContext, useEffect, useMemo } from 'react';
import { SoulVaultEventsContext } from '@/context/SoulVaultEventsProvider';
import type { SoulVaultContractKind } from '@/lib/onchain/types';

export type UseEventsOptions = {
  /** Filter by contract kind; omit for everything. */
  kinds?: readonly SoulVaultContractKind[];
  /** Scan history on mount and keep polling for new events. */
  live?: boolean;
  pollSeconds?: number;
};

export function useEvents(options: UseEventsOptions = {}) {
  const ctx = useContext(SoulVaultEventsContext);
  if (!ctx) throw new Error('useEvents requires <SoulVaultEventsProvider> in the tree');

  const { live = false, pollSeconds } = options;
  const { status, isLive, refresh, startLive, events: allEvents } = ctx;
  const kindsKey = options.kinds ? options.kinds.join(',') : '';

  useEffect(() => {
    if (status === 'idle' && !live) void refresh();
  }, [status, live, refresh]);

  useEffect(() => {
    if (live && !isLive) void startLive(pollSeconds);
  }, [live, isLive, startLive, pollSeconds]);

  const events = useMemo(() => {
    if (!kindsKey) return allEvents;
    const wanted = kindsKey.split(',') as SoulVaultContractKind[];
    return allEvents.filter((e) => wanted.includes(e.sourceKind));
  }, [allEvents, kindsKey]);

  return { ...ctx, events };
}
