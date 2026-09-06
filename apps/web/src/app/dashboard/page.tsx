import type { Metadata } from "next";
import { Wallet } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Dashboard",
  description:
    "Connect a wallet to manage organizations, swarms, epochs, and document grants.",
};

/**
 * Placeholder shell. The real dashboard is wallet-native: no account, no
 * server-side session — connecting a wallet is what resolves identity, and
 * every panel below reads its state from chain + 0G.
 */
const panels = [
  {
    title: "Organizations & swarms",
    body: "Profiles resolved from ENS, membership and epoch state read from the swarm contract on 0G.",
  },
  {
    title: "Backups & epochs",
    body: "Rotate the epoch key, inspect wrapped bundles, and verify that every current member can decrypt.",
  },
  {
    title: "Documents & grants",
    body: "Prepare redacted artifacts, issue per-field grants to wallets and share the redacted bundle.",
  },
  {
    title: "Treasury",
    body: "Balances, deposits, and the fund-request queue for agents that need to spend.",
  },
];

export default function DashboardPage() {
  return (
    <PageShell
      eyebrow="Dashboard"
      title="Wallet-native, by construction"
      description="There is no signup and no user database. Connecting a wallet is what establishes identity — every panel here reads its state from the chain and from 0G, so the same view works on any machine."
    >
      <div className="border border-border bg-card p-8">
        <div className="flex flex-col items-start gap-4">
          <span className="flex size-10 items-center justify-center border border-border-strong text-muted-foreground">
            <Wallet className="size-5" />
          </span>
          <div>
            <p className="font-medium">Wallet connection</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Not wired up yet. The connector lands with the first dashboard
              panel.
            </p>
          </div>
          <Button disabled>Connect wallet</Button>
        </div>
      </div>

      <div className="mt-px grid gap-px border border-border bg-border sm:grid-cols-2">
        {panels.map((panel) => (
          <div key={panel.title} className="bg-card p-6">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold tracking-tight">{panel.title}</h2>
              <span className="border border-border px-1.5 py-0.5 chip text-muted-foreground">
                soon
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {panel.body}
            </p>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
