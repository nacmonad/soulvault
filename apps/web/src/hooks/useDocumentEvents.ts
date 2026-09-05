'use client';

import { useEvents, type UseEventsOptions } from './useEvents';

/**
 * Document redaction/rehydration events: DocumentPublished, SlotKeyGranted,
 * SlotRevoked. Grants are narrowable via parseDocumentEvent(); active grants
 * for a wallet via resolveGrants(docHash, recipient).
 */
export function useDocumentEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  return useEvents({ ...options, kinds: ['document'] });
}
