"use client";

import { useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { runTreasuryCreate, type WizardStep } from "@/lib/create-flows";
import { errorMessage, wizardStepFailed } from "@/lib/error-message";
import { chainById, SEPOLIA_CHAIN_ID, WIZARD_CHAINS } from "@/lib/chains";
import { coinTypeForChain } from "@/lib/ens-writes";
import { CliRecoveryHint, ConnectorGate, DevicePromptPanel, PartialFailureNote, StepList } from "@/components/create/wizard-steps";

const INITIAL_STEPS: WizardStep[] = [
  { id: "deploy", label: "Deploy SoulVaultTreasury (you become owner)", status: "pending" },
  { id: "ens", label: "Publish ENSIP-11 addr on the org ENS name", status: "pending" },
  { id: "treasuryList", label: "Add to the org's soulvault.treasuries ENS record", status: "pending" },
];

/** Treasury creation wizard (ticket 009), embeddable in the Treasury tab. */
export function TreasuryWizard({ orgEnsName }: { orgEnsName: string }) {
  const { address } = useSoulVaultWallet();
  const [chainId, setChainId] = useState<number>(SEPOLIA_CHAIN_ID);
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ address: Address; blockNumber: bigint } | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  // `treasury create` has no --rpc/--chain-id flags — the CLI reads them from
  // env, so the recovery command carries inline overrides instead.
  const cliCommand =
    `SOULVAULT_RPC_URL=${chainById(chainId)?.rpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com"} ` +
    `SOULVAULT_CHAIN_ID=${chainId} ` +
    `pnpm soulvault treasury create --organization ${orgEnsName}`;

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
      setSteps((prev) => prev.map(wizardStepFailed));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 max-w-xl">
      <p className="text-sm text-muted-foreground">
        Deploys a <span className="font-mono">SoulVaultTreasury</span> for{" "}
        <span className="font-mono">{orgEnsName}</span> on the selected chain, publishes it via
        ENSIP-11 at coinType <span className="font-mono">{coinTypeForChain(chainId)}</span> on
        Sepolia, and lists it in the org&apos;s{" "}
        <span className="font-mono">soulvault.treasuries</span> record. ENS coordination always
        stays on Sepolia — the treasury address lands there as a multichain record. Two to three
        wallet signatures (plus network-switch prompts for non-Sepolia chains); the connected
        wallet becomes the immutable owner.
      </p>

      <div className="mt-3">
        <label className="text-sm font-medium" htmlFor="treasury-chain">
          Deployment chain
        </label>
        <select
          id="treasury-chain"
          className="mt-1 block w-full max-w-xs border border-border bg-background px-3 py-2 text-sm"
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
        >
          {WIZARD_CHAINS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3">
        <ConnectorGate />
        <DevicePromptPanel />
        <Button onClick={() => void onCreate()} disabled={busy} className="mt-3">
          {busy ? "Waiting for wallet…" : "Create treasury"}
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
            <p className="text-sm font-medium">Treasury deployed</p>
            <p className="mt-1 font-mono text-xs">{outcome.address}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {chainById(chainId)?.name ?? `chain ${chainId}`} · deploy block {outcome.blockNumber.toString()} ·
              published on the org ENS record — events flow automatically, no env entry needed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
