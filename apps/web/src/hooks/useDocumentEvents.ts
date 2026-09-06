'use client';

import { useMemo } from 'react';
import type { Address } from 'viem';
import { useEvents, type UseEventsOptions } from './useEvents';
import { reduceDocumentState, resolveActiveGrants } from '@/lib/onchain/reducers';
import { parseDocumentEvent } from '@/lib/onchain/watcher';
import type { SoulVaultDocumentEvent } from '@/lib/onchain/types';

export type UseDocumentEventsOptions = Omit<UseEventsOptions, 'kinds'> & {
  /** When set, also derives the delivered grants for this wallet. */
  recipient?: Address;
};

/**
 * Document redaction/rehydration events, reduced into a registry
 * (docHash → author/slots) and — when `recipient` is passed — the grants
 * delivered to that wallet. A delivered READ grant is a permanent capability
 * (spec §3).
 */
export function useDocumentEvents(options: UseDocumentEventsOptions = {}) {
  const { recipient, ...rest } = options;
  const base = useEvents({ ...rest, kinds: ['document'] });
  const documents = useMemo(() => reduceDocumentState(base.events), [base.events]);
  const activeGrants = useMemo(() => {
    if (!recipient) return [];
    const docEvents = base.events
      .map(parseDocumentEvent)
      .filter((e): e is SoulVaultDocumentEvent => e !== null);
    return resolveActiveGrants(docEvents, recipient);
  }, [base.events, recipient]);
  return { ...base, documents, activeGrants };
}
