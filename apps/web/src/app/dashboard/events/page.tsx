"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useEvents } from "@/hooks/useEvents";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { explorerTxUrl, shortAddress, shortTx } from "@/lib/format";
import type { SoulVaultContractKind, SoulVaultEvent } from "@/lib/onchain/types";

const KINDS: SoulVaultContractKind[] = ["document", "swarm", "treasury", "identity"];

export default function EventsPage() {
  const { address } = useSoulVaultWallet();
  const { events, status, isLive, startLive, stopLive, error, sources, refresh } = useEvents();
  const [kind, setKind] = useState<SoulVaultContractKind | "all">("all");
  const [txQuery, setTxQuery] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const chainId = getBrowserSoulVaultClientConfig()?.chainId;

  const rows = useMemo(() => {
    const tx = txQuery.trim().toLowerCase();
    const addr = addressQuery.trim().toLowerCase();
    const filtered = events.filter((event) => {
      if (kind !== "all" && event.sourceKind !== kind) return false;
      if (tx && !event.txHash.toLowerCase().includes(tx)) return false;
      if (addr && !eventMatchesAddress(event, addr)) return false;
      return true;
    });
    return filtered.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return Number(b.blockNumber - a.blockNumber);
      return Number(b.logIndex - a.logIndex);
    });
  }, [events, kind, txQuery, addressQuery]);

  if (!address) return null;

  return (
    <div>
      <p className="eyebrow text-primary">Events</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Chain log</h1>
        <Button size="sm" variant={isLive ? "secondary" : "outline"} onClick={() => (isLive ? stopLive() : void startLive())}>
          {isLive ? "Live on" : "Start live"}
        </Button>
      </div>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Client-side filter over the shared watcher cache. No backend.
      </p>
      {error instanceof Error ? <p className="mt-3 text-sm text-destructive">{error.message}</p> : null}

      <details className="mt-4 border border-border bg-card px-4 py-3">
        <summary className="cursor-pointer text-sm font-semibold">
          Event pipeline — {sources.length} source{sources.length === 1 ? "" : "s"} on the watcher
          <span className={`ml-2 chip ${status === "error" ? "text-destructive" : "text-primary"}`}>{status}</span>
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Contracts whose events this dashboard scans. Document/identity registries are
          discovered on the protocol root ENS name; swarm/treasury come from the selected
          org&apos;s records. If a contract you expect is missing here, its events are
          invisible everywhere — fix discovery, not the pages.
        </p>
        {sources.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nothing registered yet — the org bridge resolves ENS records shortly after mount.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border border border-border">
            {sources.map((source, index) => (
              <li key={`${source.kind}:${source.address}:${index}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 py-2">
                <span className="chip">{source.kind}</span>
                <CopyableAddress address={source.address} />
                {source.label ? <span className="text-xs text-muted-foreground">{source.label}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Button size="xs" variant="outline" onClick={() => void refresh()} disabled={status === "loading"}>
            Rescan now
          </Button>
        </div>
      </details>

      <div className="mt-6 flex flex-wrap gap-2">
        <FilterChip label="all" active={kind === "all"} onClick={() => setKind("all")} />
        {KINDS.map((value) => (
          <FilterChip key={value} label={value} active={kind === value} onClick={() => setKind(value)} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={txQuery}
          onChange={(event) => setTxQuery(event.target.value)}
          placeholder="tx hash"
          className="h-8 min-w-48 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
        />
        <input
          value={addressQuery}
          onChange={(event) => setAddressQuery(event.target.value)}
          placeholder="address"
          className="h-8 min-w-48 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
        />
      </div>

      {status === "loading" && events.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">Scanning history…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">No events match this filter.</p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="border-b border-border bg-card text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Block</th>
                <th className="px-3 py-2 font-medium">Tx</th>
                <th className="px-3 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Event</th>
                <th className="px-3 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event) => {
                const explorer = explorerTxUrl(event.txHash, chainId);
                return (
                  <tr key={`${event.txHash}:${event.logIndex}`} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{event.blockNumber.toString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {explorer ? (
                        <a href={explorer} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                          {shortTx(event.txHash)}
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="text-primary"
                          onClick={() => void navigator.clipboard.writeText(event.txHash).catch(() => undefined)}
                        >
                          {shortTx(event.txHash)}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">{event.sourceKind}</td>
                    <td className="px-3 py-2 font-medium">{event.eventName}</td>
                    <td className="px-3 py-2 text-muted-foreground">{summarize(event)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <Button size="xs" variant={active ? "default" : "outline"} onClick={onClick}>
      {label}
    </Button>
  );
}

function eventMatchesAddress(event: SoulVaultEvent, query: string) {
  const haystack = [
    event.source,
    "author" in event ? event.author : "",
    "recipient" in event ? event.recipient : "",
    "args" in event ? JSON.stringify(event.args) : "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function summarize(event: SoulVaultEvent) {
  if (event.eventName === "DocumentPublished" && "author" in event) {
    return `${shortAddress(event.author)} · ${event.slotIds.length} slots`;
  }
  if (event.eventName === "SlotKeyGranted" && "recipient" in event) {
    return `${event.slotId} → ${shortAddress(event.recipient)}`;
  }
  if (event.eventName === "RehydrationRequested" && "rehydrationPublicKey" in event) {
    return `${shortAddress(event.recipient)} requested · key ${event.rehydrationPublicKey.slice(0, 10)}…`;
  }
  if ("args" in event) {
    const entries = Object.entries(event.args)
      .slice(0, 3)
      .map(([key, value]) => `${key}=${stringifyArg(value)}`);
    return entries.join(" · ") || "—";
  }
  return "—";
}

function stringifyArg(value: unknown) {
  if (typeof value === "string") return value.length > 18 ? shortAddress(value) : value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
