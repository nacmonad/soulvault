"use client";

import { useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { runSwarmCreate, type SwarmTreasuryMode, type WizardStep } from "@/lib/create-flows";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";
import { DeploymentSnippet, ConnectorGate, DevicePromptHash, PartialFailureNote, StepList } from "@/components/create/wizard-steps";

const INITIAL_STEPS: WizardStep[] = [
  { id: "treasury", label: "Resolve treasury (ENSIP-11 read)", status: "pending" },
  { id: "deploy", label: "Deploy SoulVaultSwarm(initialTreasury)", status: "pending" },
  { id: "ens", label: "Bind ENS subdomain (subnode + addr + text records)", status: "pending" },
  { id: "orgList", label: "Append label to org soulvault.swarms list", status: "pending" },
  { id: "verify", label: "Read back swarm.treasury() and verify", status: "pending" },
];

type Outcome = {
  swarmAddress: Address;
  swarmEnsName: string;
  blockNumber: bigint;
  boundTreasury: Address;
};

/** Swarm creation wizard (ticket 009), embeddable in the Swarm tab. */
export function SwarmWizard({ orgEnsName }: { orgEnsName: string }) {
  const { address } = useSoulVaultWallet();
  const { setSwarm } = useDashboardSelection();
  const chainId = getBrowserSoulVaultClientConfig()?.chainId ?? 11155111;
  const [label, setLabel] = useState("");
  const [treasuryMode, setTreasuryMode] = useState<SwarmTreasuryMode>("discover");
  const [treasuryOverride, setTreasuryOverride] = useState("");
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  async function onCreate() {
    if (!address || !orgEnsName || !label.trim()) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps((prev) => prev.map((s) => ({ ...s, status: "pending", txHash: undefined, detail: undefined })));
    try {
      const result = await runSwarmCreate({
        from: address,
        organizationEnsName: orgEnsName,
        swarmLabel: label.trim(),
        treasuryMode,
        treasuryOverride: treasuryOverride.trim() ? (treasuryOverride.trim() as Address) : undefined,
        chainId,
        onStep: updateStep,
      });
      setOutcome({
        swarmAddress: result.swarmAddress,
        swarmEnsName: result.swarmEnsName,
        blockNumber: result.blockNumber,
        boundTreasury: result.boundTreasury,
      });
      setSwarm(label.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swarm creation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Deploys a <span className="font-mono">SoulVaultSwarm</span> bound to{" "}
        {orgEnsName}&apos;s treasury (discovered via ENSIP-11), then binds the ENS
        subdomain and appends the label to the org&apos;s swarm list. Six wallet
        signatures total.
      </p>

      <div>
        <label className="text-sm font-medium" htmlFor="swarm-label">
          Swarm label (subdomain of {orgEnsName})
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            id="swarm-label"
            className="w-48 border border-border bg-background px-3 py-2 font-mono text-sm"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="primary"
          />
          <span className="font-mono text-sm text-muted-foreground">.{orgEnsName}</span>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium" htmlFor="treasury-mode">
          Treasury binding
        </label>
        <select
          id="treasury-mode"
          className="mt-1 block w-full max-w-xs border border-border bg-background px-3 py-2 text-sm"
          value={treasuryMode}
          onChange={(e) => setTreasuryMode(e.target.value as SwarmTreasuryMode)}
        >
          <option value="discover">Discover via ENSIP-11 (recommended)</option>
          <option value="override">Explicit address override</option>
          <option value="none">None (stealth — bind later)</option>
        </select>
      </div>

      {treasuryMode === "override" ? (
        <div>
          <label className="text-sm font-medium" htmlFor="treasury-override">
            Treasury address
          </label>
          <input
            id="treasury-override"
            className="mt-1 block w-full max-w-md border border-border bg-background px-3 py-2 font-mono text-sm"
            value={treasuryOverride}
            onChange={(e) => setTreasuryOverride(e.target.value)}
            placeholder="0x…"
          />
        </div>
      ) : null}

      <div>
        <ConnectorGate />
        <DevicePromptHash />
        <Button onClick={() => void onCreate()} disabled={busy || !label.trim()} className="mt-3">
          {busy ? "Waiting for wallet…" : "Create swarm"}
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
            <p className="text-sm font-medium">Swarm deployed</p>
            <p className="mt-1 font-mono text-xs">{outcome.swarmEnsName} → {outcome.swarmAddress}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Bound treasury {shortAddress(outcome.boundTreasury)} · deploy block {outcome.blockNumber.toString()}
            </p>
            <pre className="mt-3 overflow-x-auto bg-muted p-3 font-mono text-xs">
{`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"swarm","address":"${outcome.swarmAddress}","fromBlock":"${outcome.blockNumber}","label":"${label.trim()}"},
  …existing entries…
]`}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
