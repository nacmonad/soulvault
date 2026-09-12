"use client";

import { useState } from "react";
import { type Address } from "viem";
import type { SecpWrappedKey } from "@soulvault/protocol";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { grantSlots, type GrantSlotsResult } from "@/lib/document-registry";
import { errorMessage } from "@/lib/error-message";
import { shortAddress } from "@/lib/format";
import type { WizardStep } from "@/lib/create-flows";
import { ConnectorGate, DevicePromptPanel, StepList } from "@/components/create/wizard-steps";

export type GrantWizardGrant = {
  slotId: string;
  recipient: Address;
  wrap: SecpWrappedKey;
};

export type GrantWizardRequest = {
  docHash: string;
  /** Wallet connected to the dashboard — the tx sender (author of record). */
  from: Address;
  recipient: Address;
  /** sha256 fingerprint of the recipient's rehydration public key (display). */
  recipientKeyFingerprint: string | null;
  grants: GrantWizardGrant[];
};

/**
 * Grant flow wizard: the selected slot keys are already wrapped to the
 * recipient's rehydration key (local crypto, no signing) when the wizard
 * opens; signing delivers them on-chain.
 *
 * The point of the wizard is device transparency: while a Ledger session
 * signs, the provider surfaces the keccak hash of the unsigned tx plus a
 * decoded summary — the device cannot render SoulVault selectors (no CAL
 * descriptor), so the user verifies that hash on the device screen before
 * approving. One batch tx when the deployed registry supports
 * `grantSlotKeys`; otherwise one tx per slot, same event format.
 */
export function GrantWizard({
  request,
  onComplete,
  onCancel,
}: {
  request: GrantWizardRequest;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { sendTransaction } = useSoulVaultWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deliverStep, setDeliverStep] = useState<WizardStep>({
    id: "deliver",
    label: `Deliver wrapped keys on-chain (SlotKeyGranted ×${request.grants.length})`,
    status: "pending",
  });
  const [result, setResult] = useState<GrantSlotsResult | null>(null);

  const steps: WizardStep[] = [
    {
      id: "wrap",
      label: `Wrap ${request.grants.length} slot key${request.grants.length === 1 ? "" : "s"} to the recipient's rehydration key`,
      status: "done",
      detail: request.recipientKeyFingerprint
        ? `key ${request.recipientKeyFingerprint.slice(0, 12)}…`
        : request.recipient,
    },
    deliverStep,
  ];

  async function onGrant() {
    setBusy(true);
    setError(null);
    setDeliverStep((prev) => ({ ...prev, status: "signing" }));
    try {
      const outcome = await grantSlots({
        from: request.from,
        documentId: request.docHash,
        grants: request.grants,
        send: sendTransaction,
      });
      setDeliverStep((prev) => ({
        ...prev,
        status: "done",
        txHash: outcome.hashes[0],
        detail: outcome.batched ? "1 batch tx" : `${outcome.hashes.length} txs`,
      }));
      setResult(outcome);
    } catch (e) {
      setDeliverStep((prev) => ({ ...prev, status: "failed" }));
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border border-border p-4">
      <p className="text-sm font-medium">
        Grant {request.grants.length} slot{request.grants.length === 1 ? "" : "s"} to{" "}
        <span className="font-mono">{shortAddress(request.recipient)}</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        A delivered READ grant is a permanent capability — there is no revoke.
        Wrap material rides the <span className="font-mono">SlotKeyGranted</span>{" "}
        events; raw slot keys never leave this browser.
      </p>

      <div className="mt-3">
        <ConnectorGate />
        <DevicePromptPanel />
        <StepList steps={steps} />
        {!result && !busy ? (
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void onGrant()}>Sign &amp; deliver</Button>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 border-l-2 border-red-600 pl-3 text-sm text-red-600">{error}</div>
        ) : null}
        {result ? (
          <div className="mt-3 border border-border p-3">
            <p className="text-sm font-medium">
              Delivered — {result.batched ? "1 batch tx" : `${result.hashes.length} txs (registry predates batch)`}
            </p>
            {result.hashes.map((hash) => (
              <a
                key={hash}
                className="mt-1 block break-all font-mono text-xs text-primary underline"
                href={`https://sepolia.etherscan.io/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
              >
                tx {hash}
              </a>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">
              The recipient rehydrates from the Rehydrate tab: the events carry the
              wrapped keys, and their rehydration key unwraps them locally.
            </p>
            <Button variant="outline" className="mt-2" onClick={onComplete}>
              Done
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
