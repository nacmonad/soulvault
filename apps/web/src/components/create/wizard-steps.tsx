"use client";

import { type Address } from "viem";

import { shortAddress } from "@/lib/format";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import type { WizardStep } from "@/lib/create-flows";

/**
 * Ledger sessions sign every wizard transaction on the device (no injected
 * wallet needed) — show an informational note so the user knows what to expect.
 */
export function ConnectorGate() {
  const { connector, address } = useSoulVaultWallet();
  if (connector !== "ledger") return null;
  return (
    <p className="border-l-2 border-primary pl-3 text-sm">
      Signing with your Ledger{address ? <span className="font-mono"> ({shortAddress(address)})</span> : null} — confirm
      each transaction on the device. No browser wallet is needed; transactions are broadcast via the configured RPC.
    </p>
  );
}

/**
 * While the device prompt is up, show what is being approved: the decoded tx
 * checklist (the device cannot render it — SoulVault selectors have no CAL
 * descriptor, and deploys never can) plus the keccak hash of the unsigned tx,
 * which matches what the device displays when it blind-signs.
 */
export function DevicePromptPanel() {
  const { connector, devicePrompt } = useSoulVaultWallet();
  if (connector !== "ledger" || !devicePrompt) return null;
  return (
    <div className="border border-amber-500 p-3 text-xs">
      <p>
        <span className="font-medium">Confirm on Ledger:</span> {devicePrompt.summary.title}
      </p>
      <ul className="mt-1 space-y-0.5 font-mono">
        {devicePrompt.summary.lines.map((line, i) => (
          <li key={i} className="break-all">{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-muted-foreground">
        No CAL descriptor exists for this payload — the device shows a blind-sign prompt.
        Verify this hash on your Ledger matches before approving:
      </p>
      <p className="break-all font-mono">{devicePrompt.hash}</p>
    </div>
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
