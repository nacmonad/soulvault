"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useDocumentRegistryAddress } from "@/hooks/useDocumentRegistryAddress";
import {
  clearDocumentRegistryOverride,
  getDocumentRegistryOverride,
} from "@/lib/document-registry";
import { readDocumentRegistryEntries } from "@/lib/ens-writes";
import { DocumentRegistryWizard } from "@/components/create/document-registry-wizard";

const ROOT_ENS_NAME_FALLBACK = process.env.NEXT_PUBLIC_SOULVAULT_ENS_ROOT_NAME || "soulvault.eth";

const SOURCE_LABEL: Record<string, string> = {
  override: "Local browser override",
  ens: "ENS — addr(root, coinType) on the protocol root name",
  bundle: "Public bundle hint (non-authoritative)",
};

/**
 * DocumentRegistry deploy + discovery admin (ticket 012 §D v1). One registry
 * per chain; events here drive the Overview/Organization document panels and
 * every author/consumer listener.
 */
export default function DocumentRegistryPage() {
  const { address } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const { address: registry, source } = useDocumentRegistryAddress();
  const [override, setOverrideState] = useState<Address | null>(null);
  const [entries, setEntries] = useState<string[] | null>(null);

  // The registry is announced on the selected organization's .eth name (the
  // operator's wallet owns it); env/default as fallback when no org selected.
  const rootEnsName = selection.orgId ?? ROOT_ENS_NAME_FALLBACK;

  useEffect(() => {
    setOverrideState(getDocumentRegistryOverride());
    let cancelled = false;
    readDocumentRegistryEntries(rootEnsName, undefined, address ?? undefined)
      .then((records) => {
        if (cancelled) return;
        setEntries(
          records.map(
            (entry) => `${entry.address} (chain ${entry.chainId}, block ${entry.deployedAtBlock ?? "?"})`,
          ),
        );
      })
      .catch(() => {
        /* read is best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [registry, rootEnsName, address]);

  if (!address) return null;

  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Document registry</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        The global per-chain registry anchoring the documents lane: publish, grants, and
        rehydrate all resolve through it, and its events feed the Overview/Organization
        document panels and every external consumer. Discovery order: browser override →
        ENS (<span className="font-mono">addr({rootEnsName}, coinType)</span>) → env → bundle
        hint.
      </p>

      <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
        <div className="bg-card px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Resolved ENS registry</dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {registry ? <CopyableAddress address={registry} /> : "not discovered"}
          </dd>
          {source ? (
            <p className="mt-1 text-xs text-muted-foreground">{SOURCE_LABEL[source] ?? source}</p>
          ) : null}
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs font-medium text-muted-foreground">Browser override</dt>
          <dd className="mt-1 font-mono text-xs break-all">{override ?? "none"}</dd>
          {override ? (
            <Button
              variant="ghost"
              className="mt-2"
              onClick={() => {
                clearDocumentRegistryOverride();
                setOverrideState(null);
              }}
            >
              Clear override
            </Button>
          ) : null}
        </div>
        <div className="bg-card px-4 py-3 sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground">
            ENS <span className="font-mono">soulvault.documentRegistry</span> record
          </dt>
          <dd className="mt-1 font-mono text-xs break-all">
            {entries === null
              ? "unreachable RPC"
              : entries.length === 0
                ? "not published"
                : null}
          </dd>
          {entries && entries.length > 0 ? (
            <ul className="mt-1 space-y-1">
              {entries.map((line) => (
                <li key={line} className="font-mono text-xs break-all">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </dl>

      {!registry ? (
        <p className="mt-4 border-l-2 border-amber-500 pl-3 text-sm text-amber-600">
          No registry discovered — Redact cannot publish and Grants/Rehydrate are blocked until
          one is deployed and announced.
        </p>
      ) : null}

      <section className="mt-8 border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Deploy a new registry</h2>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
          Protocol-level operation: the connected wallet must own{" "}
          <span className="font-mono">{rootEnsName}</span> (the selected organization's ENS name
          {selection.orgId ? "" : " — select an organization first, or set NEXT_PUBLIC_SOULVAULT_ENS_ROOT_NAME"}).
          Only needed once per chain.
        </p>
        <DocumentRegistryWizard rootEnsName={rootEnsName} />
      </section>

      <p className="mt-6 text-xs text-muted-foreground">
        Back to <Link href="/dashboard/documents/redact" className="underline">Redact</Link>.
      </p>
    </div>
  );
}
