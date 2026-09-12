'use client';

import { useMemo } from 'react';
import { useEvents, type UseEventsOptions } from './useEvents';
import { agentSwarmContractFromUri, reduceAgentState } from '@/lib/onchain/reducers';

/** ERC-8004 identity events reduced into an agent directory (current URI + metadata per agent).
 * Each profile carries `swarmContract` — decoded from the URI payload — the
 * on-chain attribution key consumers use to org-scope the directory (the
 * identity registry is global, so raw AgentRegistered events are not
 * org-scoped). */
export function useAgentEvents(options: Omit<UseEventsOptions, 'kinds'> = {}) {
  const base = useEvents({ ...options, kinds: ['identity'] });
  const agentDirectory = useMemo(() => reduceAgentState(base.events), [base.events]);
  const agentProfiles = useMemo(
    () =>
      [...agentDirectory.byId.values()].map((profile) => ({
        ...profile,
        swarmContract: agentSwarmContractFromUri(profile.uri),
      })),
    [agentDirectory],
  );
  return { ...base, agentDirectory, agentProfiles };
}
