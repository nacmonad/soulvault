'use client';

import { useEvents, type UseEventsOptions } from './useEvents';

/** Swarm contract events (membership, epochs, backups, messaging, funds). */
export function useSwarmEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  return useEvents({ ...options, kinds: ['swarm'] });
}
