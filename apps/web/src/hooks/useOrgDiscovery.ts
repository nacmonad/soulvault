"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readOrgSwarms,
  readTreasuryBalances,
  type OrgSwarmEntry,
} from "@/lib/ens-discovery";
import { readOrgTreasuries, type OrgTreasuryEntry } from "@/lib/ens-writes";

export type OrgDiscoveryState = {
  treasuries: OrgTreasuryEntry[] | null;
  treasuryBalances: Record<string, bigint>;
  swarms: OrgSwarmEntry[] | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  refresh: () => void;
};

/**
 * Everything the org's ENS name publishes, loaded in parallel: the
 * `soulvault.treasuries` JSON record, per-chain treasury balances, and the
 * `soulvault.swarms` list with each swarm subdomain resolved (addr + chain).
 * This is the state-summary source for Overview / Treasury / Swarm.
 */
export function useOrgDiscovery(orgEnsName: string | null): OrgDiscoveryState {
  const [treasuries, setTreasuries] = useState<OrgTreasuryEntry[] | null>(null);
  const [treasuryBalances, setTreasuryBalances] = useState<Record<string, bigint>>({});
  const [swarms, setSwarms] = useState<OrgSwarmEntry[] | null>(null);
  const [status, setStatus] = useState<OrgDiscoveryState["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!orgEnsName) {
      setTreasuries(null);
      setTreasuryBalances({});
      setSwarms(null);
      setStatus("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const [nextTreasuries, nextSwarms] = await Promise.all([
          readOrgTreasuries(orgEnsName),
          readOrgSwarms(orgEnsName),
        ]);
        if (cancelled) return;
        setTreasuries(nextTreasuries);
        setSwarms(nextSwarms);
        setStatus("ready");
        const balances = await readTreasuryBalances(nextTreasuries);
        if (!cancelled) setTreasuryBalances(balances);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgEnsName, nonce]);

  return { treasuries, treasuryBalances, swarms, status, error, refresh };
}
