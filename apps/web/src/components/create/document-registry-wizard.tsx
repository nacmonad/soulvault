"use client";

import { useState } from "react";
import { type Address, type Hex } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { runDocumentRegistryDeploy, type WizardStep } from "@/lib/create-flows";
import { errorMessage, wizardStepFailed } from "@/lib/error-message";
import { SEPOLIA_CHAIN_ID } from "@/lib/chains";
import { coinTypeForChain } from "@/lib/ens-writes";
import {
  setDocumentRegistryOverride,
  clearDocumentRegistryOverride,
} from "@/lib/document-registry";
import { CliRecoveryHint, ConnectorGate, DevicePromptPanel, PartialFailureNote, StepList } from "@/components/create/wizard-steps";

const INITIAL_STEPS: WizardStep[] = [
  { id: "deploy", label: "Deploy SoulVaultDocumentRegistry (Sepolia singleton)", status: "pending" },
  { id: "ens", label: "Publish ENSIP-11 addr on the protocol root name", status: "pending" },
  { id: "record", label: "Write the soulvault.documentRegistry text record", status: "pending" },
];

type Outcome = { address: Address; blockNumber: bigint; recordTxHash: Hex | null };

/**
 * DocumentRegistry deploy wizard (ticket 012 §D v1). Protocol-level, not
 * org-scoped, but the announce targets the root ENS name passed in — the
 * dashboard's selected organization (e.g. soulvault-demo.eth), which the
 * connected wallet must own. One registry per chain — publishing a new address
 * for the same chain replaces the ENS records, but existing grants stay
 * anchored to the registry that delivered them.
 */
export function DocumentRegistryWizard({ rootEnsName }: { rootEnsName: string }) {
  const { address } = useSoulVaultWallet();
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [overrideApplied, setOverrideApplied] = useState(false);
  // Set once the deploy step lands — a failure after that point must not
  // re-deploy a second registry via the CLI recovery path.
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep>) {
    if (stepId === "deploy" && update.detail) setDeployedAddress(update.detail as Address);
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  // If the contract deploy already landed, recover with the announce-only CLI
  // command (no second deploy, no wasted gas); otherwise the full deploy flow.
  const deployStep = steps.find((s) => s.id === "deploy");
  const cliCommand = deployedAddress
    ? `pnpm soulvault document announce-registry --address ${deployedAddress} --root-ens-name ${rootEnsName}` +
      (deployStep?.txHash ? ` --deployed-at-tx ${deployStep.txHash}` : "")
    : `pnpm soulvault document deploy-registry --root-ens-name ${rootEnsName}`;

  async function onDeploy() {
    if (!address || !rootEnsName) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setOverrideApplied(false);
    setSteps(INITIAL_STEPS);
    setDeployedAddress(null);
    try {
      const result = await runDocumentRegistryDeploy({
        from: address,
        rootEnsName,
        chainId: SEPOLIA_CHAIN_ID,
        onStep: updateStep,
      });
      setOutcome({
        address: result.registryAddress,
        blockNumber: result.blockNumber,
        recordTxHash: result.recordTxHash,
      });
    } catch (e) {
      setSteps((prev) => prev.map(wizardStepFailed));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Deploys the <span className="font-mono">SoulVaultDocumentRegistry</span> singleton on
        Sepolia and announces it on <span className="font-mono">{rootEnsName}</span> via ENSIP-11
        at coinType <span className="font-mono">{coinTypeForChain(SEPOLIA_CHAIN_ID)}</span>, plus
        the <span className="font-mono">soulvault.documentRegistry</span> text record carrying the
        deploy block. This is protocol infrastructure —{" "}
        <strong>the connected wallet must own {rootEnsName}</strong>. Three wallet signatures.
      </p>

      <div className="mt-3">
        <ConnectorGate />
        <DevicePromptPanel />
        <Button onClick={() => void onDeploy()} disabled={busy} className="mt-3">
          {busy ? "Waiting for wallet…" : "Deploy document registry"}
        </Button>
        <StepList steps={steps} />
        {error ? (
          <div className="mt-3 border-l-2 border-red-600 pl-3 text-sm text-red-600">
            {error}
            <PartialFailureNote steps={steps} />
            <CliRecoveryHint command={cliCommand} />
          </div>
        ) : null}
        {outcome ? (
          <div className="mt-4 border border-border p-4">
            <p className="text-sm font-medium">Document registry deployed</p>
            <p className="mt-1 font-mono text-xs break-all">{outcome.address}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Sepolia · deploy block {outcome.blockNumber.toString()}
              {outcome.recordTxHash ? " · text record updated" : ""}
            </p>
            {overrideApplied ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Local override active for this browser. Clear it once the ENS record resolves
                everywhere.
              </p>
            ) : (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDocumentRegistryOverride(outcome.address);
                    setOverrideApplied(true);
                  }}
                >
                  Use this registry in this browser
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    clearDocumentRegistryOverride();
                    setOverrideApplied(false);
                  }}
                >
                  Clear override
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Events flow automatically — the dashboard discovers this registry via the org
              ENS record; no env entry needed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
