'use client';

import { useMemo } from 'react';
import { useEvents, type UseEventsOptions } from './useEvents';
import { reduceSwarmState } from '@/lib/onchain/reducers';

/**
 * Swarm + treasury events with derived state. Listens to both contract kinds
 * because the fund lifecycle spans them (FundRequestApproved on the swarm,
 * FundsReleased on the treasury); the reduced state carries members,
 * pending join requests, epoch/treasury binding, and fund request statuses.
 */
export function useSwarmEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  const base = useEvents({ ...options, kinds: ['swarm', 'treasury'] });
  const swarm = useMemo(() => reduceSwarmState(base.events), [base.events]);
  return { ...base, ...swarm };
}
