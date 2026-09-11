"use client";

import { useState } from "react";

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
  DEFAULT_EPOCH_SECONDS,
  parseEnsV2OrgLabel,
  registerOrganizationEnsV2,
} from "@/lib/ens-register-v2";
import type { WizardStep } from "@/lib/create-flows";

const INITIAL_STEPS: WizardStep[] = [
  { id: "deploy", label: "Deploy org registry via VerifiableFactory (tx 1/2)", status: "pending" },
  { id: "register", label: "Register name with epoch expiry (tx 2/2)", status: "pending" },
  { id: "mirror", label: "Write soulvault.ensv2Registry pointer record", status: "pending" },
  { id: "metadata", label: "Write class and name records", status: "pending" },
];

export function OrgWizardV2() {
  const { address } = useSoulVaultWallet();
  const { rememberOrg } = useDashboardSelection();
  const [displayName, setDisplayName] = useState("");
  const [ensName, setEnsName] = useState("");
  const [expiryDays, setExpiryDays] = useState("30");
  const [steps, setSteps] = useState<WizardStep[]>(INITIAL_STEPS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{
    ensName: string;
    registryAddress: string;
    expiryDays: number;
  } | null>(null);

  function updateStep(stepId: string, update: Partial<WizardStep> & { detail?: string }) {
    setSteps((prev) =>
      prev.map((s) => {
        if (s.id !== stepId) return s;
        const label = update.detail ? `${s.label} — ${update.detail}` : s.label;
        const status = update.status ?? s.status;
        return { ...s, label, status };
      }),
    );
  }

  const preview = (() => {
    try {
      return parseEnsV2OrgLabel(ensName).normalized;
    } catch {
      return null;
    }
  })();

  const cliCommand = `pnpm soulvault organization register-ens --organization ${preview ? preview : "<slug>"} --ens-v2`;

  // Epoch length in days → seconds. Clamped to >= 1 so a cleared field can't mint
  // an instantly-expired name.
  const epochDays = Math.max(1, Math.floor(Number(expiryDays) || 0));

  async function onCreate() {
    if (!address) return;
    setBusy(true);
    setError(null);
    setOutcome(null);
    setSteps(INITIAL_STEPS);
    try {
      const result = await registerOrganizationEnsV2({
        from: address,
        displayName,
        ensName,
        epochSeconds: epochDays * 86400,
        onStep: (stepId, update) =>
          updateStep(stepId, {
            // lib speaks "active"/"done"; StepStatus speaks signing/mining/done.
            status: update.status === "done" ? "done" : "signing",
            ...(update.detail ? { detail: update.detail } : {}),
          }),
      });
      rememberOrg(result.ensName);
      setOutcome({
        ensName: result.ensName,
        registryAddress: result.registryAddress,
        expiryDays: Math.round(Number(result.expiry - BigInt(Math.floor(Date.now() / 1000))) / 86400),
      });
    } catch (e) {
      setSteps((prev) => prev.map(wizardStepFailed));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 max-w-xl border border-border p-4">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Create organization (ENSv2)</p>
        <span className="border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          beta
        </span>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Deploys the org&apos;s registry through the ENSv2 VerifiableFactory and registers{" "}
        <span className="font-mono">{preview || "<name>.eth"}</span> with a{" "}
        {epochDays}-day epoch expiry. No commit/reveal wait;
        the owner holds EAC roles (set-resolver, renew) on the name.
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
            placeholder="soulvault.eth"
            className="mt-1 block h-8 w-full border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
          />
        </label>
        <label className="text-sm">
          Epoch expiry (days)
          <input
            type="number"
            min={1}
            value={expiryDays}
            onChange={(event) => setExpiryDays(event.target.value)}
            placeholder="30"
            className="mt-1 block h-8 w-full border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
          />
        </label>
      </div>

      <div className="mt-3">
        <ConnectorGate />
        <DevicePromptPanel />
        <Button
          onClick={() => void onCreate()}
          disabled={busy || !address || !displayName.trim() || !ensName.trim()}
          className="mt-3"
          size="sm"
        >
          {busy ? "Waiting for wallet…" : "Create organization (ENSv2)"}
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
            <p className="text-sm font-medium">Organization registered on ENSv2</p>
            <p className="mt-1 font-mono text-xs">{outcome.ensName}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              registry {outcome.registryAddress} · expires in ~{outcome.expiryDays}d
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
