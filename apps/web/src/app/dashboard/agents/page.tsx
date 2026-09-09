"use client";

import { useMemo, useState } from "react";
import { isAddressEqual } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { shortAddress } from "@/lib/format";

export default function AgentsPage() {
  const { address } = useSoulVaultWallet();
  const { agentProfiles, status } = useAgentEvents();
  const swarm = useSwarmEvents();
  const [scope, setScope] = useState<"wallet" | "swarm" | "all">("wallet");

  const swarmWallets = useMemo(() => [...swarm.members.keys()], [swarm.members]);

  const rows = useMemo(() => {
    if (!address) return [];
    return agentProfiles.filter((profile) => {
      if (scope === "all") return true;
      if (scope === "wallet") return isAddressEqual(profile.wallet, address);
      return swarmWallets.some((member) => isAddressEqual(member, profile.wallet));
    });
  }, [address, agentProfiles, scope, swarmWallets]);

  if (!address) return null;

  return (
    <div>
      <p className="eyebrow text-primary">Agents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">ERC-8004 directory</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Reduced from identity events. URI and metadata writes stay soon.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["wallet", "swarm", "all"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={scope === value ? "default" : "outline"}
            onClick={() => setScope(value)}
          >
            {value === "wallet" ? "This wallet" : value === "swarm" ? "Swarm members" : "All"}
          </Button>
        ))}
      </div>

      {status === "loading" ? <p className="mt-6 text-sm text-muted-foreground">Loading identity events…</p> : null}
      {status === "ready" && rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No agents in this filter.</p>
      ) : (
        <ul className="mt-6 space-y-px border border-border bg-border">
          {rows.map((profile) => (
            <li key={profile.agentId.toString()} className="bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-mono text-sm">#{profile.agentId.toString()}</p>
                <p className="font-mono text-xs text-muted-foreground">{shortAddress(profile.wallet)}</p>
              </div>
              <p className="mt-2 break-all text-sm">{profile.uri ?? "— no URI —"}</p>
              {Object.keys(profile.metadata).length > 0 ? (
                <dl className="mt-3 grid gap-1 text-xs">
                  {Object.entries(profile.metadata).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">No metadata keys.</p>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled variant="outline" size="xs">
                  Edit metadata <span className="chip ml-2">soon</span>
                </Button>
                <Button disabled variant="outline" size="xs">
                  Set URI <span className="chip ml-2">soon</span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
