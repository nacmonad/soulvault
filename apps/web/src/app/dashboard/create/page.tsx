"use client";

import { useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import {
  runSwarmCreate,
  runTreasuryCreate,
  type SwarmTreasuryMode,
  type WizardStep,
} from "@/lib/create-flows";
import { coinTypeForChain } from "@/lib/ens-writes";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

type TreasuryOutcome = { address: Address; blockNumber: bigint; deployTxHash: string; ensTxHash: string };
type SwarmOutcome = {
  swarmAddress: Address;
  swarmEnsName: string;
  blockNumber: bigint;
  boundTreasury: Address;
  deployTxHash: string;
};

function StepList({ steps }: { steps: WizardStep[] }) {
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

export default function CreatePage() {
  const { address } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const config = getBrowserSoulVaultClientConfig();
  const chainId = config?.chainId ?? 11155111;

  // --- Treasury wizard state ---
  const [treasurySteps, setTreasurySteps] = useState<WizardStep[]>([
    { id: "deploy", label: "Deploy SoulVaultTreasury (you become owner)", status: "pending" },
    { id: "ens", label: "Publish ENSIP-11 addr on the org ENS name", status: "pending" },
  ]);
  const [treasuryBusy, setTreasuryBusy] = useState(false);
  const [treasuryOutcome, setTreasuryOutcome] = useState<TreasuryOutcome | null>(null);
  const [treasuryError, setTreasuryError] = useState<string | null>(null);

  // --- Swarm wizard state ---
  const [swarmLabel, setSwarmLabel] = useState("");
  const [treasuryMode, setTreasuryMode] = useState<SwarmTreasuryMode>("discover");
  const [treasuryOverride, setTreasuryOverride] = useState("");
  const [swarmSteps, setSwarmSteps] = useState<WizardStep[]>([
    { id: "treasury", label: "Resolve treasury (ENSIP-11 read)", status: "pending" },
    { id: "deploy", label: "Deploy SoulVaultSwarm(initialTreasury)", status: "pending" },
    { id: "ens", label: "Bind ENS subdomain (subnode + addr + text records)", status: "pending" },
    { id: "orgList", label: "Append label to org soulvault.swarms list", status: "pending" },
    { id: "verify", label: "Read back swarm.treasury() and verify", status: "pending" },
  ]);
  const [swarmBusy, setSwarmBusy] = useState(false);
  const [swarmOutcome, setSwarmOutcome] = useState<SwarmOutcome | null>(null);
  const [swarmError, setSwarmError] = useState<string | null>(null);

  if (!address) return null;

  const orgEnsName = selection.orgId;
  if (!orgEnsName) {
    return (
      <div>
        <p className="eyebrow text-primary">Create</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Select an organization first</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Both wizards write ENS records under an org name you control. Select an org on the
          Organization page, then come back.
        </p>
      </div>
    );
  }

  function updateStep(
    setter: React.Dispatch<React.SetStateAction<WizardStep[]>>,
    stepId: string,
    update: Partial<WizardStep>,
  ) {
    setter((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  async function onTreasuryCreate() {
    if (!address || !orgEnsName) return;
    setTreasuryBusy(true);
    setTreasuryError(null);
    setTreasuryOutcome(null);
    setTreasurySteps([
      { id: "deploy", label: "Deploy SoulVaultTreasury (you become owner)", status: "pending" },
      { id: "ens", label: "Publish ENSIP-11 addr on the org ENS name", status: "pending" },
    ]);
    try {
      const result = await runTreasuryCreate({
        from: address,
        organizationEnsName: orgEnsName,
        chainId,
        onStep: (stepId, update) => updateStep(setTreasurySteps, stepId, update),
      });
      setTreasuryOutcome({
        address: result.treasuryAddress,
        blockNumber: result.blockNumber,
        deployTxHash: result.deployTxHash,
        ensTxHash: result.ensTxHash,
      });
    } catch (error) {
      setTreasuryError(error instanceof Error ? error.message : "Treasury creation failed.");
    } finally {
      setTreasuryBusy(false);
    }
  }

  async function onSwarmCreate() {
    if (!address || !orgEnsName) return;
    setSwarmBusy(true);
    setSwarmError(null);
    setSwarmOutcome(null);
    setSwarmSteps((prev) => prev.map((s) => ({ ...s, status: "pending", txHash: undefined, detail: undefined })));
    try {
      const result = await runSwarmCreate({
        from: address,
        organizationEnsName: orgEnsName,
        swarmLabel: swarmLabel.trim(),
        treasuryMode,
        treasuryOverride: treasuryOverride.trim() ? (treasuryOverride.trim() as Address) : undefined,
        chainId,
        onStep: (stepId, update) => updateStep(setSwarmSteps, stepId, update),
      });
      setSwarmOutcome({
        swarmAddress: result.swarmAddress,
        swarmEnsName: result.swarmEnsName,
        blockNumber: result.blockNumber,
        boundTreasury: result.boundTreasury,
        deployTxHash: result.deployTxHash,
      });
    } catch (error) {
      setSwarmError(error instanceof Error ? error.message : "Swarm creation failed.");
    } finally {
      setSwarmBusy(false);
    }
  }

  return (
    <div className="space-y-10">
      {/* ---------------- Treasury wizard ---------------- */}
      <section>
        <p className="eyebrow text-primary">Create</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Treasury</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Deploys a <span className="font-mono">SoulVaultTreasury</span> for{" "}
          <span className="font-mono">{orgEnsName}</span> and publishes it via ENSIP-11 at
          coinType <span className="font-mono">{coinTypeForChain(chainId)}</span>. Two wallet
          signatures. The connected wallet becomes the immutable owner.
        </p>

        <div className="mt-4 max-w-xl">
          <Button onClick={() => void onTreasuryCreate()} disabled={treasuryBusy}>
            {treasuryBusy ? "Waiting for wallet…" : "Create treasury"}
          </Button>
          <StepList steps={treasurySteps} />
          {treasuryError ? (
            <p className="mt-3 border-l-2 border-red-600 pl-3 text-sm text-red-600">
              {treasuryError}
              {treasurySteps.some((s) => s.status === "done")
                ? " Partial state: steps marked ✓ are already on-chain; re-run only when you know what remains."
                : ""}
            </p>
          ) : null}
          {treasuryOutcome ? (
            <div className="mt-4 border border-border p-4">
              <p className="text-sm font-medium">Treasury deployed</p>
              <p className="mt-1 font-mono text-xs">{treasuryOutcome.address}</p>
              <p className="mt-1 text-xs text-muted-foreground">Deploy block {treasuryOutcome.blockNumber.toString()}</p>
              <pre className="mt-3 overflow-x-auto bg-muted p-3 font-mono text-xs">
{`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"treasury","address":"${treasuryOutcome.address}","fromBlock":"${treasuryOutcome.blockNumber}","label":"${orgEnsName}"},
  …existing entries…
]`}
              </pre>
            </div>
          ) : null}
        </div>
      </section>

      {/* ---------------- Swarm wizard ---------------- */}
      <section>
        <h2 className="text-xl font-semibold tracking-tight">Swarm</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Deploys a <span className="font-mono">SoulVaultSwarm</span> bound to{" "}
          {orgEnsName}&apos;s treasury (discovered via ENSIP-11), then binds the ENS
          subdomain and appends the label to the org&apos;s swarm list. Six wallet
          signatures total.
        </p>

        <div className="mt-4 max-w-xl space-y-3">
          <div>
            <label className="text-sm font-medium" htmlFor="swarm-label">
              Swarm label (subdomain of {orgEnsName})
            </label>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="swarm-label"
                className="w-48 border border-border bg-background px-3 py-2 font-mono text-sm"
                value={swarmLabel}
                onChange={(e) => setSwarmLabel(e.target.value)}
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

          <Button onClick={() => void onSwarmCreate()} disabled={swarmBusy || !swarmLabel.trim()}>
            {swarmBusy ? "Waiting for wallet…" : "Create swarm"}
          </Button>

          <StepList steps={swarmSteps} />

          {swarmError ? (
            <p className="border-l-2 border-red-600 pl-3 text-sm text-red-600">
              {swarmError}
              {swarmSteps.some((s) => s.status === "done")
                ? " Partial state: steps marked ✓ are already on-chain; re-run only what remains."
                : ""}
            </p>
          ) : null}

          {swarmOutcome ? (
            <div className="border border-border p-4">
              <p className="text-sm font-medium">Swarm deployed</p>
              <p className="mt-1 font-mono text-xs">{swarmOutcome.swarmEnsName} → {swarmOutcome.swarmAddress}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Bound treasury {shortAddress(swarmOutcome.boundTreasury)} · deploy block {swarmOutcome.blockNumber.toString()}
              </p>
              <pre className="mt-3 overflow-x-auto bg-muted p-3 font-mono text-xs">
{`NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS=[
  {"kind":"swarm","address":"${swarmOutcome.swarmAddress}","fromBlock":"${swarmOutcome.blockNumber}","label":"${swarmLabel.trim()}"},
  …existing entries…
]`}
              </pre>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
