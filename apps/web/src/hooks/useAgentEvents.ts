'use client';

import { useEvents, type UseEventsOptions } from './useEvents';

/** ERC-8004 identity registry events (agent registration/profile). */
export function useAgentEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  return useEvents({ ...options, kinds: ['identity'] });
}
