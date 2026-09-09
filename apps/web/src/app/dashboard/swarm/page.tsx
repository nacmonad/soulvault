"use client";

import { useMemo } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { SwarmWizard } from "@/components/create/swarm-wizard";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

type SwarmListItem = {
  id: string;
  label: string;
  address: Address | null;
  chainId: number | null;
  source: "env" | "ens";
};

export default function SwarmPage() {
  const { address } = useSoulVaultWallet();
  const { selection, setSwarm } = useDashboardSelection();
  const swarm = useSwarmEvents();
  const discovery = useOrgDiscovery(selection.orgId);
  const config = getBrowserSoulVaultClientConfig();

  /** ENS-published swarms first (web3-native), env deployments merged in. */
  const items = useMemo<SwarmListItem[]>(() => {
    const envSwarms =
      config?.deployments.filter((item) => item.kind === "swarm") ?? [];
    const ensItems: SwarmListItem[] = (discovery.swarms ?? []).map((entry) => ({
      id: entry.label,
      label: entry.label,
      address: entry.address,
      chainId: entry.chainId,
      source: "ens" as const,
    }));
    const envItems: SwarmListItem[] = envSwarms
      .filter((d) => !ensItems.some((e) => e.address?.toLowerCase() === d.address.toLowerCase()))
      .map((d) => ({
        id: d.label ?? d.address,
        label: d.label ?? shortAddress(d.address),
        address: d.address,
        chainId: config?.chainId ?? null,
        source: "env" as const,
      }));
    return [...ensItems, ...envItems];
  }, [config, discovery.swarms]);

  if (!address) return null;

  const members = [...swarm.members.values()];
  const pending = [...swarm.pendingJoins.values()];
  const empty = swarm.status === "ready" && members.length === 0 && pending.length === 0 && swarm.currentEpoch === null;
  const selected = items.find((item) => item.id === selection.swarmId) ?? null;
  const selectedIsEnsOnly = selected?.source === "ens";

  return (
    <div>
      <p className="eyebrow text-primary">Swarm</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Membership and epoch</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Reduced from swarm + treasury events. Join, approve, and epoch rotate stay off this page.
      </p>

      {items.length > 0 ? (
        <ul className="mt-6 border border-border">
          {items.map((item) => {
            const isCurrent = selection.swarmId === item.id;
            return (
              <li key={`${item.source}:${item.id}`} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <button
                  type="button"
                  className={`font-mono text-sm ${isCurrent ? "text-primary" : ""}`}
                  onClick={() => setSwarm(item.id)}
                >
                  {item.label}
                </button>
                {item.address ? (
                  <CopyableAddress address={item.address} chainId={item.chainId} />
                ) : null}
                {item.chainId !== null ? (
                  <span className="font-mono text-xs text-muted-foreground">chain {item.chainId}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">via {item.source}</span>
                {isCurrent ? <span className="chip text-primary">current</span> : null}
              </li>
            );
          })}
        </ul>
      ) : discovery.status === "loading" ? (
        <p className="mt-6 text-sm text-muted-foreground">Reading the org&apos;s ENS swarm list…</p>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          No swarms published on the org&apos;s ENS <span className="font-mono">soulvault.swarms</span>{" "}
          record and none in config. Create one below.
        </p>
      )}

      {selectedIsEnsOnly ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {selected?.label} is discovered via ENS but not in the event-cache config, so
          members/epoch below follow the env-configured swarm. Live events for ENS-discovered
          swarms land with deployment bootstrap (ticket 012).
        </p>
      ) : null}

      {empty ? (
        <p className="mt-8 text-sm text-muted-foreground">No swarm events yet.</p>
      ) : (
        <>
          <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
            <Field label="Epoch" value={swarm.currentEpoch !== null ? swarm.currentEpoch.toString() : "—"} />
            <Field
              label="Membership version"
              value={swarm.membershipVersion !== null ? swarm.membershipVersion.toString() : "—"}
            />
            <Field label="Treasury" value={swarm.treasury ? shortAddress(swarm.treasury) : "—"} mono />
            <Field label="Members" value={String(members.length)} />
          </dl>

          <h2 className="mt-8 text-sm font-semibold">Members</h2>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No members in reduced state.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {members.map((member) => (
                <li key={member.wallet} className="flex justify-between gap-3 border-b border-border px-4 py-2 font-mono text-sm last:border-b-0">
                  <span>{shortAddress(member.wallet)}</span>
                  <span className="text-muted-foreground">epoch {member.joinedEpoch.toString()}</span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="mt-8 text-sm font-semibold">Pending joins</h2>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {pending.map((request) => (
                <li key={request.requestId.toString()} className="border-b border-border px-4 py-2 font-mono text-sm last:border-b-0">
                  {shortAddress(request.requester)} · #{request.requestId.toString()}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button disabled variant="outline" size="sm">
          Fund requests <span className="chip ml-2">soon</span>
        </Button>
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Create swarm</summary>
          {selection.orgId ? (
            <SwarmWizard orgEnsName={selection.orgId} />
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Select an organization first — the swarm binds an ENS subdomain under the
              org name and is appended to the org&apos;s swarm list.
            </p>
          )}
        </details>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card p-5">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className={`mt-2 text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
