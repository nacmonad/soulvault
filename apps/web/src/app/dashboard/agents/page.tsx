"use client";

import { useMemo, useState } from "react";
import { isAddressEqual } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { AgentIdentityCard } from "@/components/dashboard/agent-identity-card";
import { shortAddress } from "@/lib/format";

export default function AgentsPage() {
  const { address } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const { agentProfiles, status } = useAgentEvents();
  const swarm = useSwarmEvents();
  const discovery = useOrgDiscovery(selection.orgId);
  const [scope, setScope] = useState<"org" | "wallet" | "swarm" | "all">("org");

  const swarmWallets = useMemo(() => [...swarm.members.keys()], [swarm.members]);
  const orgSwarmContracts = useMemo(
    () =>
      (discovery.swarms ?? [])
        .map((entry) => entry.address)
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((address) => address.toLowerCase()),
    [discovery.swarms],
  );

  const rows = useMemo(() => {
    if (!address) return [];
    return agentProfiles.filter((profile) => {
      if (scope === "all") return true;
      if (scope === "wallet") return isAddressEqual(profile.wallet, address);
      if (scope === "org") {
        // The identity registry is global; org-scope by the swarmContract the
        // registration URI carries. Agents without attribution stay hidden.
        return !!profile.swarmContract && orgSwarmContracts.includes(profile.swarmContract.toLowerCase());
      }
      return swarmWallets.some((member) => isAddressEqual(member, profile.wallet));
    });
  }, [address, agentProfiles, scope, swarmWallets, orgSwarmContracts]);

  if (!address) return null;

  return (
    <div>
      <p className="eyebrow text-primary">Agents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">ERC-8004 directory</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Reduced from identity events. URI and metadata writes stay soon.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {(["org", "wallet", "swarm", "all"] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={scope === value ? "default" : "outline"}
            onClick={() => setScope(value)}
          >
            {value === "org" ? "This organization" : value === "wallet" ? "This wallet" : value === "swarm" ? "Swarm members" : "All"}
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
              <AgentIdentityCard agentId={profile.agentId} wallet={profile.wallet} uri={profile.uri} />
              {Object.keys(profile.metadata).length > 0 ? (
                <dl className="mt-3 grid gap-1 text-xs">
                  {Object.entries(profile.metadata).map(([key, value]) => (
                    <div key={key} className="flex gap-2">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
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
