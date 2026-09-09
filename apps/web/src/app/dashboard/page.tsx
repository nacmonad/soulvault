"use client";

import { useEffect, useState } from "react";
import { type Address } from "viem";

import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { readOrgTreasuries, type OrgTreasuryEntry } from "@/lib/ens-writes";
import { shortAddress } from "@/lib/format";

export default function DashboardOverviewPage() {
  const { address, connector, error: walletError } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const { documents: registry, status: documentStatus, error: documentError } =
    useDocumentEvents();
  const swarm = useSwarmEvents();

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
        <Stat label="Organization" value={selection.orgId ?? "—"} />
        <Stat
          label="Swarm epoch"
          value={swarm.currentEpoch !== null ? swarm.currentEpoch.toString() : "—"}
          hint={selection.swarmId}
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

      <OrgTreasuriesPanel orgEnsName={selection.orgId} />
    </div>
  );
}

/**
 * Treasuries discovered from the org's ENS `soulvault.treasuries` record — the
 * enumerable discovery index that complements the ENSIP-11 addr slots. Read-only:
 * derived from chain state, not a user database.
 */
function OrgTreasuriesPanel({ orgEnsName }: { orgEnsName: string | null }) {
  const [entries, setEntries] = useState<OrgTreasuryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    setError(null);
    if (!orgEnsName) return;
    let cancelled = false;
    readOrgTreasuries(orgEnsName)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [orgEnsName]);

  if (!orgEnsName) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Treasuries</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        From the org's ENS <span className="font-mono">soulvault.treasuries</span> record on{" "}
        <span className="font-mono">{orgEnsName}</span> — one entry per chain.
      </p>
      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : entries === null ? (
        <p className="mt-3 text-sm text-muted-foreground">…</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No treasuries published yet — create one in the Treasury tab.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border border border-border">
          {entries.map((entry) => (
            <li key={entry.chainId} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-card px-4 py-3">
              <span className="font-mono text-xs text-muted-foreground">chain {entry.chainId}</span>
              <span className="font-mono text-sm">{shortAddress(entry.address as Address)}</span>
              {entry.label ? <span className="text-xs text-muted-foreground">{entry.label}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
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
