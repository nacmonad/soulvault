"use client";

import { Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";

export function ConnectPanel() {
  const { connectLedger, connectBrowserWallet, isBrowserWalletAvailable, status, error } =
    useSoulVaultWallet();
  const busy = status === "connecting" || status === "loading-activity";

  return (
    <div className="border border-border bg-card p-8">
      <div className="flex flex-col items-start gap-4">
        <span className="flex size-10 items-center justify-center border border-border-strong text-muted-foreground">
          <Wallet className="size-5" />
        </span>
        <div>
          <p className="eyebrow text-primary">Wallet</p>
          <p className="mt-2 font-medium">Connect to continue</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            There is no account database. Ledger or an injected browser wallet is
            identity. Every dashboard panel reads chain events for that address.
          </p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void connectLedger()} disabled={busy}>
            {busy ? "Connecting…" : "Connect Ledger"}
          </Button>
          <Button
            variant="outline"
            onClick={() => void connectBrowserWallet()}
            disabled={busy || !isBrowserWalletAvailable}
          >
            Connect browser wallet
          </Button>
        </div>
        {!isBrowserWalletAvailable ? (
          <p className="text-xs text-muted-foreground">
            No injected wallet detected. Ledger still works on Chromium + HTTPS
            or localhost.
          </p>
        ) : null}
      </div>
    </div>
  );
}
