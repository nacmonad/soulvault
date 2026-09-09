"use client";

import { useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { runTreasuryCreate, type WizardStep } from "@/lib/create-flows";
import { coinTypeForChain } from "@/lib/ens-writes";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { DeploymentSnippet, ConnectorGate, PartialFailureNote, StepList } from "@/components/create/wizard-steps";

const INITIAL_STEPS: WizardStep[] = [
  { id: "deploy", label: "Deploy SoulVaultTreasury (you become owner)", status: "pending" },
  { id: "ens", label: "Publish ENSIP-11 addr on the org ENS name", status: "pending" },
];

type Outcome = { address: Address; blockNumber: bigint };

/** Treasury creation wizard (ticket 009), embeddable in the Treasury tab. */
export function TreasuryWizard({ orgEnsName }: { orgEnsName: string }) {
  const { address } = useSoulVaultWallet();
  const chainId = getBrowserSoulVaultClientConfig()?.chainId ?? 11155111;
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ address: Address; blockNumber: bigint } | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  async function onCreate() {
    if (!address || !orgEnsName) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps(INITIAL_STEPS);
    try {
      const result = await runTreasuryCreate({
        from: address,
        organizationEnsName: orgEnsName,
        chainId,
        onStep: updateStep,
      });
      setOutcome({ address: result.treasuryAddress, blockNumber: result.blockNumber });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Treasury creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Deploys a <span className="font-mono">SoulVaultTreasury</span> for{" "}
        <span className="font-mono">{orgEnsName}</span> and publishes it via ENSIP-11 at
        coinType <span className="font-mono">{coinTypeForChain(chainId)}</span>. Two wallet
        signatures; the connected wallet becomes the immutable owner.
      </p>
      <div className="mt-3">
        <ConnectorGate />
        <Button onClick={() => void onCreate()} disabled={busy} className="mt-3">
          {busy ? "Waiting for wallet…" : "Create treasury"}
        </Button>
        <StepList steps={steps} />
        {error ? (
          <p className="mt-3 border-l-2 border-red-600 pl-3 text-sm text-red-600">
            {error}
            <PartialFailureNote steps={steps} />
          </p>
        ) : null}
        {outcome ? (
          <div className="mt-4 border border-border p-4">
            <p className="text-sm font-medium">Treasury deployed</p>
            <p className="mt-1 font-mono text-xs">{outcome.address}</p>
            <p className="mt-1 text-xs text-muted-foreground">Deploy block {outcome.blockNumber.toString()}</p>
            <DeploymentSnippet>
{`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"treasury","address":"${outcome.address}","fromBlock":"${outcome.blockNumber}","label":"${orgEnsName}"},
  …existing entries…
]`}
            </DeploymentSnippet>
          </div>
        ) : null}
      </div>
    </div>
  );
}
