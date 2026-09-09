"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

export default function SwarmPage() {
  const { address } = useSoulVaultWallet();
  const { selection, setSwarm } = useDashboardSelection();
  const swarm = useSwarmEvents();
  const deployments = useMemo(
    () => getBrowserSoulVaultClientConfig()?.deployments.filter((item) => item.kind === "swarm") ?? [],
    [],
  );

  if (!address) return null;

  const members = [...swarm.members.values()];
  const pending = [...swarm.pendingJoins.values()];
  const empty = swarm.status === "ready" && members.length === 0 && pending.length === 0 && swarm.currentEpoch === null;

  return (
    <div>
      <p className="eyebrow text-primary">Swarm</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Membership and epoch</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Reduced from swarm + treasury events. Join, approve, and epoch rotate stay off this page.
      </p>

      {deployments.length > 0 ? (
        <ul className="mt-6 border border-border">
          {deployments.map((item) => {
            const id = item.label ?? item.address;
            return (
              <li key={item.address} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <button
                  type="button"
                  className={`font-mono text-sm ${selection.swarmId === id ? "text-primary" : ""}`}
                  onClick={() => setSwarm(id)}
                >
                  {item.label ?? shortAddress(item.address)}
                </button>
                {selection.swarmId === id ? <span className="chip text-primary">current</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          No swarm deployments in config. Reduced state below still follows the event cache.
        </p>
      )}

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
