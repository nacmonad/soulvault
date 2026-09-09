"use client";

import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { clearRpcUrlOverride, getRpcUrlOverride, setRpcUrlOverride } from "@/lib/rpc-settings";

type Probe = { status: "idle" | "probing" | "ok" | "error"; detail?: string };

export default function SettingsPage() {
  const { address } = useSoulVaultWallet();
  const [draft, setDraft] = useState("");
  const [override, setOverride] = useState<string | null>(null);
  const [envRpc, setEnvRpc] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<Probe>({ status: "idle" });

  useEffect(() => {
    setOverride(getRpcUrlOverride());
    setEnvRpc(process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL);
  }, []);

  if (!address) return null;

  const effective = override ?? envRpc;

  async function onTest() {
    setProbe({ status: "idle" });
    const normalized = setRpcUrlOverride(draft);
    if (!normalized) {
      setError("Not a valid http(s) URL.");
      return;
    }
    setProbe({ status: "error" });
    try {
      const client = createPublicClient({ transport: http(normalized) });
      const [block, chainId] = await Promise.all([
        client.getBlockNumber(),
        client.getChainId(),
      ]);
      setProbe({ status: "idle", detail: `reached — chainId ${chainId}, tip ${block}` });
    } catch (e) {
      setProbe({ status: "error", detail: e instanceof Error ? e.message : "request failed" });
    }
  }

  function onSave() {
    const normalized = setRpcUrlOverride(draft);
    if (!normalized) {
      setError("Not a valid http(s) URL — nothing saved.");
      return;
    }
    setOverride(normalized);
    setDraft("");
    setError(null);
  }

  function onClear() {
    clearRpcUrlOverride();
    setOverride(null);
    setError(null);
    setProbe({ status: "idle" });
  }

  return (
    <div>
      <p className="eyebrow text-primary">Settings</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">RPC endpoint</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        All dashboard chain reads and writes target the effective endpoint below.
        Free public endpoints rate-limit burst requests — a personal-token or
        dedicated endpoint removes that ceiling. Stored in this browser only.
      </p>

      <dl className="mt-4 max-w-xl space-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">Effective</dt>
          <dd className="font-mono text-xs break-all">{effective ?? "— not configured —"}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted-foreground">Source</dt>
          <dd className="font-mono text-xs">{override ? "browser override" : "NEXT_PUBLIC_SOULVAULT_RPC_URL"}</dd>
        </div>
      </dl>

      <div className="mt-6 max-w-xl">
        <label className="text-sm font-medium" htmlFor="rpc-url">
          Override RPC URL
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="rpc-url"
            className="w-full border border-border bg-background px-3 py-2 font-mono text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://ethereum-sepolia-rpc.personal-token.example/v3/…"
          />
        </div>
        {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
        <p className="mt-1 text-xs text-muted-foreground">
          Candidate test: {probe.detail ?? (probe.status === "error" ? "failed" : "not run")}
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" onClick={() => void onTest()} disabled={!draft.trim()}>
            Test
          </Button>
          <Button onClick={onSave} disabled={!draft.trim()}>
            Save override
          </Button>
          <Button variant="ghost" onClick={onClear} disabled={!override}>
            Clear
          </Button>
        </div>
        {override ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Override active — takes effect on the next chain read (reload the page to re-scan).
          </p>
        ) : null}
      </div>
    </div>
  );
}
