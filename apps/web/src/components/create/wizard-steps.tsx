"use client";

import { type Address } from "viem";

import { shortAddress } from "@/lib/format";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import type { WizardStep } from "@/lib/create-flows";

/**
 * Browser deploys submit eth_sendTransaction via the injected wallet — a DMK
 * Ledger session can't do that, so warn before the wizard is run.
 */
export function ConnectorGate() {
  const { connector, address } = useSoulVaultWallet();
  if (connector !== "ledger") return null;
  return (
    <p className="border-l-2 border-amber-500 pl-3 text-sm">
      The dashboard is connected to a Ledger device session, which can't submit
      transactions from the browser. Connect a browser wallet (MetaMask etc.) holding
      {address ? <span className="font-mono"> {shortAddress(address)}</span> : " the org owner address"} to run
      this wizard.
    </p>
  );
}

export function StepList({ steps }: { steps: WizardStep[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {steps.map((step) => (
        <li key={step.id} className="flex items-start gap-2 text-sm">
          <span className="mt-0.5 w-4 shrink-0 text-center font-mono">
            {step.status === "done" ? "✓" : step.status === "signing" ? "…" : step.status === "mining" ? "⏳" : step.status === "failed" ? "✗" : "·"}
          </span>
          <span className={step.status === "done" ? "text-muted-foreground" : ""}>
            {step.label}
            {step.detail ? <span className="ml-2 font-mono text-xs">{shortAddress(step.detail as Address) ?? step.detail}</span> : null}
            {step.txHash ? (
              <a
                className="ml-2 font-mono text-xs text-primary underline"
                href={`https://sepolia.etherscan.io/tx/${step.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                tx {step.txHash.slice(0, 10)}…
              </a>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PartialFailureNote({ steps }: { steps: WizardStep[] }) {
  if (!steps.some((s) => s.status === "done")) return null;
  return (
    <span className="block">
      Partial state: steps marked ✓ are already on-chain; re-run only what remains.
    </span>
  );
}

export function DeploymentSnippet({ children }: { children: string }) {
  return <pre className="mt-3 overflow-x-auto bg-muted p-3 font-mono text-xs">{children}</pre>;
}
