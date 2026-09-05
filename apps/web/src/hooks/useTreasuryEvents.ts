'use client';

import { useEvents, type UseEventsOptions } from './useEvents';

/** Treasury contract events (deposits, releases, withdrawals). */
export function useTreasuryEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  return useEvents({ ...options, kinds: ['treasury'] });
}
