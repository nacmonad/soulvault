'use client';

import { useMemo } from 'react';
import { useEvents, type UseEventsOptions } from './useEvents';
import { reduceAgentState } from '@/lib/onchain/reducers';

/** ERC-8004 identity events reduced into an agent directory (current URI + metadata per agent). */
export function useAgentEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  const base = useEvents({ ...options, kinds: ['identity'] });
  const agentDirectory = useMemo(() => reduceAgentState(base.events), [base.events]);
  const agentProfiles = useMemo(() => [...agentDirectory.byId.values()], [agentDirectory]);
  return { ...base, agentDirectory, agentProfiles };
}
