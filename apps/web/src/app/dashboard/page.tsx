"use client";

import { useEffect, useState } from "react";

import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { loadDashboardSelection } from "@/lib/dashboard-context";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function DashboardOverviewPage() {
  const { address, connector, error: walletError } = useSoulVaultWallet();
  const { documents: registry, status: documentStatus, error: documentError } =
    useDocumentEvents();
  const swarm = useSwarmEvents();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [swarmId, setSwarmId] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setOrgId(null);
      setSwarmId(null);
      return;
    }
    const selection = loadDashboardSelection(address);
    setOrgId(selection.orgId);
    setSwarmId(selection.swarmId);
  }, [address]);

  if (!address) return null;

  const documentCount = registry.documents.size;
  const configError =
    documentStatus === "error"
      ? documentError instanceof Error
        ? documentError.message
        : "Could not load SoulVault events."
      : null;

  return (
    <div>
      <p className="eyebrow text-primary">Overview</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Connected wallet</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Identity is this address. Panels below are derived from chain events, not
        a user database.
      </p>
      {walletError ? <p className="mt-4 text-sm text-destructive">{walletError}</p> : null}
      {configError ? <p className="mt-4 text-sm text-destructive">{configError}</p> : null}

      <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
        <Stat label="Address" value={shortAddress(address)} mono />
        <Stat label="Connector" value={connector ?? "—"} />
        <Stat label="Organization" value={orgId ?? "—"} />
        <Stat
          label="Swarm epoch"
          value={swarm.currentEpoch !== null ? swarm.currentEpoch.toString() : "—"}
          hint={swarmId}
        />
        <Stat
          label="Documents"
          value={documentStatus === "loading" ? "…" : String(documentCount)}
        />
        <Stat
          label="Events"
          value={
            documentStatus === "ready" || swarm.status === "ready"
              ? "live cache"
              : documentStatus
          }
        />
      </dl>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  hint?: string | null;
}) {
  return (
    <div className="bg-card p-5">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className={`mt-2 text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</dd>
      {hint ? <p className="mt-1 font-mono text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
