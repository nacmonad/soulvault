"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

type EnsRecord = {
  name: string;
  owner: string | null;
  resolver: string | null;
  addr: string | null;
  texts: Record<string, string>;
  error?: string;
};

const TEXT_KEYS = ["url", "description", "org", "avatar"] as const;

export default function OrgPage() {
  const { address } = useSoulVaultWallet();
  const { selection, setOrg, rememberOrg } = useDashboardSelection();
  const [draft, setDraft] = useState("");
  const [reverseName, setReverseName] = useState<string | null>(null);
  const [record, setRecord] = useState<EnsRecord | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const names = useMemo(() => {
    const set = new Set(selection.rememberedOrgs);
    if (reverseName) set.add(reverseName);
    if (selection.orgId) set.add(selection.orgId);
    return [...set];
  }, [selection.rememberedOrgs, selection.orgId, reverseName]);

  useEffect(() => {
    const config = getBrowserSoulVaultClientConfig();
    if (!address || !config || config.chainId !== sepolia.id) return;
    const client = createPublicClient({ chain: sepolia, transport: http(config.rpcUrl) });
    void client
      .getEnsName({ address })
      .then((name) => setReverseName(name))
      .catch(() => setReverseName(null));
  }, [address]);

  useEffect(() => {
    const name = selection.orgId;
    if (!name) {
      setRecord(null);
      return;
    }
    const config = getBrowserSoulVaultClientConfig();
    if (!config || config.chainId !== sepolia.id) {
      setRecord({ name, owner: null, resolver: null, addr: null, texts: {} });
      return;
    }
    const client = createPublicClient({ chain: sepolia, transport: http(config.rpcUrl) });
    setStatus("loading");
    void (async () => {
      try {
        const [addr, resolver] = await Promise.all([
          client.getEnsAddress({ name }).catch(() => null),
          client.getEnsResolver({ name }).catch(() => null),
        ]);
        const texts: Record<string, string> = {};
        for (const key of TEXT_KEYS) {
          const value = await client.getEnsText({ name, key }).catch(() => null);
          if (value) texts[key] = value;
        }
        setRecord({
          name,
          owner: addr,
          resolver,
          addr,
          texts,
        });
        setStatus("idle");
      } catch (error) {
        setRecord({
          name,
          owner: null,
          resolver: null,
          addr: null,
          texts: {},
          error: error instanceof Error ? error.message : "ENS lookup failed",
        });
        setStatus("error");
      }
    })();
  }, [selection.orgId]);

  if (!address) return null;

  function onRemember(event: FormEvent) {
    event.preventDefault();
    rememberOrg(draft);
    setDraft("");
  }

  return (
    <div>
      <p className="eyebrow text-primary">Organization</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">ENS profile</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Read-only. Switcher remembers names for this wallet. Edit stays soon.
      </p>

      <form onSubmit={onRemember} className="mt-6 flex flex-wrap gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="soulvault.eth"
          className="h-8 min-w-56 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
          aria-label="ENS name to remember"
        />
        <Button type="submit" size="sm">
          Remember name
        </Button>
      </form>

      {names.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No organization for this wallet.</p>
      ) : (
        <ul className="mt-6 border border-border">
          {names.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
              <button
                type="button"
                className={`font-mono text-sm ${selection.orgId === name ? "text-primary" : "text-foreground"}`}
                onClick={() => setOrg(name)}
              >
                {name}
              </button>
              {selection.orgId === name ? <span className="chip text-primary">current</span> : null}
            </li>
          ))}
        </ul>
      )}

      {record ? (
        <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
          <Field label="ENS name" value={record.name} mono />
          <Field label="Addr" value={record.addr ? shortAddress(record.addr as Address) : "—"} mono />
          <Field label="Resolver" value={record.resolver ? shortAddress(record.resolver as Address) : "—"} mono />
          <Field label="Owner / reverse" value={record.owner ? shortAddress(record.owner as Address) : "—"} mono />
          {TEXT_KEYS.map((key) => (
            <Field key={key} label={key} value={record.texts[key] ?? "—"} />
          ))}
        </dl>
      ) : null}
      {status === "loading" ? <p className="mt-3 text-sm text-muted-foreground">Resolving ENS…</p> : null}
      {record?.error ? <p className="mt-3 text-sm text-destructive">{record.error}</p> : null}

      <div className="mt-8">
        <Button disabled variant="outline" size="sm">
          Edit ENS metadata
          <span className="chip ml-2">soon</span>
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
