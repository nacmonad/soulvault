"use client";

import Link from "next/link";
import { formatEther, type Address } from "viem";

import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentEvents } from "@/hooks/useDocumentEvents";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { shortAddress } from "@/lib/format";

export default function DashboardOverviewPage() {
  const { address, connector, error: walletError } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const { documents: registry, status: documentStatus, error: documentError } =
    useDocumentEvents();
  const swarm = useSwarmEvents();
  const discovery = useOrgDiscovery(selection.orgId);

  if (!address) return null;

  const documentCount = registry.documents.size;
  const configError =
    documentStatus === "error"
      ? documentError instanceof Error
        ? documentError.message
        : "Could not load SoulVault events."
      : null;
  const treasuries = discovery.treasuries ?? [];
  const swarms = discovery.swarms ?? [];

  return (
    <div>
      <p className="eyebrow text-primary">Overview</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Redact on this machine</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Authorized wallets rehydrate only the fields they were granted. Identity is
        this address — no account database. Start at{" "}
        <Link href="/dashboard/documents" className="underline">
          Documents
        </Link>
        .
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

      <OrgStateSummary discovery={discovery} />
    </div>
  );
}

/**
 * ENS-derived org state: everything the org name publishes — treasuries (per
 * chain, with balances) and swarms (label, contract address, chain). Read-only;
 * this is the web3-native inventory that replaces ~/.soulvault state files.
 */
function OrgStateSummary({ discovery }: { discovery: ReturnType<typeof useOrgDiscovery> }) {
  const treasuries = discovery.treasuries;
  const swarms = discovery.swarms;

  if (discovery.status === "idle") return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Org state (ENS)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Derived from the org&apos;s ENS records —{" "}
        <span className="font-mono">soulvault.treasuries</span> and{" "}
        <span className="font-mono">soulvault.swarms</span>.
      </p>
      {discovery.error ? (
        <p className="mt-3 text-sm text-destructive">{discovery.error}</p>
      ) : (
        <>
          <h3 className="mt-4 text-xs font-medium text-muted-foreground">
            Treasuries{treasuries ? ` (${treasuries.length})` : ""}
          </h3>
          {treasuries === null ? (
            <p className="mt-2 text-sm text-muted-foreground">…</p>
          ) : treasuries.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None published yet — create one in the Treasury tab.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border border border-border">
              {treasuries.map((entry) => {
                const bal = discovery.treasuryBalances[entry.address.toLowerCase()];
                return (
                  <li key={`${entry.chainId}:${entry.address}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-card px-4 py-3">
                    <span className="font-mono text-xs text-muted-foreground">chain {entry.chainId}</span>
                    <CopyableAddress address={entry.address} chainId={entry.chainId} />
                    <span className="font-mono text-xs text-muted-foreground">
                      {bal !== undefined ? `${formatEther(bal)} ETH` : "…"}
                    </span>
                    {entry.label ? <span className="text-xs text-muted-foreground">{entry.label}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="mt-6 text-xs font-medium text-muted-foreground">
            Swarms{swarms ? ` (${swarms.length})` : ""}
          </h3>
          {swarms === null ? (
            <p className="mt-2 text-sm text-muted-foreground">…</p>
          ) : swarms.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              None published yet — create one in the Swarm tab.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border border border-border">
              {swarms.map((entry) => (
                <li key={entry.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-card px-4 py-3">
                  <span className="font-mono text-sm">{entry.ensName}</span>
                  {entry.chainId !== null ? (
                    <span className="font-mono text-xs text-muted-foreground">chain {entry.chainId}</span>
                  ) : null}
                  {entry.address ? (
                    <CopyableAddress address={entry.address} chainId={entry.chainId} />
                  ) : (
                    <span className="text-xs text-muted-foreground">addr unresolved</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
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
