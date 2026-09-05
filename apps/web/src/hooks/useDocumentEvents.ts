'use client';

import { useMemo } from 'react';
import type { Address } from 'viem';
import { useEvents, type UseEventsOptions } from './useEvents';
import { reduceDocumentState, resolveActiveGrants } from '@/lib/onchain/reducers';
import { parseDocumentEvent } from '@/lib/onchain/watcher';
import type { SoulVaultDocumentEvent } from '@/lib/onchain/types';

export type UseDocumentEventsOptions = Omit<UseEventsOptions, 'kinds'> & {
  /** When set, also derives the active grants for this wallet. */
  recipient?: Address;
  /** Clock override for expiry checks (unix seconds); defaults to now. */
  now?: bigint;
};

/**
 * Document redaction/rehydration events, reduced into a registry
 * (docHash → author/slots) and — when `recipient` is passed — the active
 * grants that wallet may unwrap right now.
 */
export function useDocumentEvents(options: UseDocumentEventsOptions = {}) {
  const { recipient, now, ...rest } = options;
  const base = useEvents({ ...rest, kinds: ['document'] });
  const documents = useMemo(() => reduceDocumentState(base.events), [base.events]);
  const activeGrants = useMemo(() => {
    if (!recipient) return [];
    const docEvents = base.events
      .map(parseDocumentEvent)
      .filter((e): e is SoulVaultDocumentEvent => e !== null);
    return resolveActiveGrants(docEvents, recipient, now === undefined ? undefined : { now });
  }, [base.events, recipient, now]);
  return { ...base, documents, activeGrants };
}
