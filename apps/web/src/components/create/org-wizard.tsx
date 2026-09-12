"use client";

import { useState } from "react";
import { formatEther } from "viem";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import {
  CliRecoveryHint,
  ConnectorGate,
  DevicePromptPanel,
  PartialFailureNote,
  StepList,
} from "@/components/create/wizard-steps";
import { errorMessage, wizardStepFailed } from "@/lib/error-message";
import {
  parseEthRootLabel,
  quoteRegistration,
  registerOrganizationEns,
} from "@/lib/ens-register";
import type { WizardStep } from "@/lib/create-flows";

const INITIAL_STEPS: WizardStep[] = [
  { id: "check", label: "Check the .eth name is available", status: "pending" },
  { id: "commit", label: "Commit registration (tx 1/2)", status: "pending" },
  { id: "wait", label: "Wait for ENS minCommitmentAge", status: "pending" },
  { id: "register", label: "Register name and pay rent (tx 2/2)", status: "pending" },
  { id: "unwrap", label: "Unwrap NameWrapper if present", status: "pending" },
  { id: "metadata", label: "Write class and name records", status: "pending" },
];

export function OrgWizard() {
  const { address } = useSoulVaultWallet();
  const { rememberOrg } = useDashboardSelection();
  const [displayName, setDisplayName] = useState("");
  const [ensName, setEnsName] = useState("");
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ valueWei: bigint; minCommitmentAge: bigint } | null>(null);
  const [outcome, setOutcome] = useState<{ ensName: string; alreadyOwned: boolean } | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep>) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, ...update } : s)));
  }

  const cliCommand =
    `pnpm soulvault organization create --name ${displayName.trim() || "<name>"} --ens-name ${ensName.trim() || "<name>.eth"} --public && ` +
    `pnpm soulvault organization register-ens --organization ${ensName.trim() || "<name>.eth"}`;

  async function onQuoteBlur() {
    try {
      const { label } = parseEthRootLabel(ensName);
      const next = await quoteRegistration(label);
      setQuote({ valueWei: next.valueWei, minCommitmentAge: next.minCommitmentAge });
    } catch {
      setQuote(null);
    }
  }

  async function onCreate() {
    if (!address) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps(INITIAL_STEPS);
    try {
      const result = await registerOrganizationEns({
        from: address,
        displayName,
        ensName,
        onStep: (stepId, update) => updateStep(stepId, update as Partial<WizardStep>),
      });
      rememberOrg(result.ensName);
      setOutcome({ ensName: result.ensName, alreadyOwned: result.alreadyOwned });
    } catch (e) {
      setSteps((prev) => prev.map(wizardStepFailed));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 max-w-xl border border-border p-4">
      <p className="text-sm font-medium">Create organization</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Registers a new root .eth name on Sepolia (commit, then register). If Sepolia has
        disabled this controller, use Remember name below with a name you already own.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Soulvault"
            className="mt-1 block h-8 w-full border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
          />
        </label>
        <label className="text-sm">
          ENS name
          <input
            value={ensName}
            onChange={(event) => setEnsName(event.target.value)}
            onBlur={() => void onQuoteBlur()}
            placeholder="soulvault.eth"
            className="mt-1 block h-8 w-full border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
          />
        </label>
      </div>
      {quote ? (
        <p className="mt-2 text-xs text-muted-foreground">
          ~{formatEther(quote.valueWei)} ETH for 1 year · wait{" "}
          {quote.minCommitmentAge.toString()}s between txs
        </p>
      ) : null}

      <div className="mt-3">
        <ConnectorGate />
        <DevicePromptPanel />
        <Button
          onClick={() => void onCreate()}
          disabled={busy || !address || !displayName.trim() || !ensName.trim()}
          className="mt-3"
          size="sm"
        >
          {busy ? "Waiting for wallet…" : "Create organization"}
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
            <p className="text-sm font-medium">
              {outcome.alreadyOwned ? "Organization selected" : "Organization registered"}
            </p>
            <p className="mt-1 font-mono text-xs">{outcome.ensName}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
