"use client";

import { useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { runSwarmCreate, type SwarmTreasuryMode, type WizardStep } from "@/lib/create-flows";
import { errorMessage, wizardStepFailed } from "@/lib/error-message";
import { chainById, SEPOLIA_CHAIN_ID, WIZARD_CHAINS } from "@/lib/chains";
import { shortAddress } from "@/lib/format";
import { CliRecoveryHint, ConnectorGate, DevicePromptPanel, PartialFailureNote, StepList } from "@/components/create/wizard-steps";

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
  const [chainId, setChainId] = useState<number>(SEPOLIA_CHAIN_ID);
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

  const cliCommand = buildSwarmCreateCommand({
    orgEnsName,
    label: label.trim(),
    chainId,
    treasuryMode,
    treasuryOverride: treasuryOverride.trim() || undefined,
  });

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
      setSteps((prev) => prev.map(wizardStepFailed));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">
        Deploys a <span className="font-mono">SoulVaultSwarm</span> on the selected chain,
        bound to {orgEnsName}&apos;s treasury (discovered via ENSIP-11 on Sepolia), then binds
        the ENS subdomain and appends the label to the org&apos;s swarm list. ENS coordination
        always stays on Sepolia. Six wallet signatures total (plus network-switch prompts for
        non-Sepolia chains).
      </p>

      <div>
        <label className="text-sm font-medium" htmlFor="swarm-chain">
          Deployment chain
        </label>
        <select
          id="swarm-chain"
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
        <DevicePromptPanel />
        <Button onClick={() => void onCreate()} disabled={busy || !label.trim()} className="mt-3">
          {busy ? "Waiting for wallet…" : "Create swarm"}
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
            <p className="text-sm font-medium">Swarm deployed</p>
            <p className="mt-1 font-mono text-xs">{outcome.swarmEnsName} → {outcome.swarmAddress}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {chainById(chainId)?.name ?? `chain ${chainId}`} · bound treasury{" "}
              {shortAddress(outcome.boundTreasury)}
              {outcome.blockNumber > 0n ? ` · deploy block ${outcome.blockNumber.toString()}` : " · adopted existing deployment"} ·
              published on the org ENS record — events flow automatically, no env entry needed.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * CLI equivalent of this wizard's swarm create — mirrors runSwarmCreate's
 * treasury-mode precedence (discover → no flag, override/none → --treasury).
 * The CLI resolves --organization by slug or ENS name.
 */
function buildSwarmCreateCommand(input: {
  orgEnsName: string;
  label: string;
  chainId: number;
  treasuryMode: SwarmTreasuryMode;
  treasuryOverride?: string;
}): string {
  const rpc = chainById(input.chainId)?.rpcUrl ?? "https://ethereum-sepolia-rpc.publicnode.com";
  const parts = [
    "pnpm soulvault swarm create",
    `--organization ${input.orgEnsName}`,
    `--name ${input.label || "<label>"}`,
    `--chain-id ${input.chainId}`,
    `--rpc ${rpc}`,
  ];
  if (input.treasuryMode === "override") {
    parts.push(`--treasury ${input.treasuryOverride ?? "0x…"}`);
  } else if (input.treasuryMode === "none") {
    parts.push("--treasury 0x0000000000000000000000000000000000000000");
  }
  return parts.join(" ");
}
