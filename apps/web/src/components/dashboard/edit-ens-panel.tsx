"use client";

import { useMemo, useState } from "react";
import { type Address } from "viem";

import { Button } from "@/components/ui/button";
import { DevicePromptPanel } from "@/components/create/wizard-steps";
import { errorMessage } from "@/lib/error-message";
import {
  fileToImageDataUri,
  repairEnsV2RegistryPointer,
  saveOrgTextRecords,
  validateAvatarValue,
  type EnsEditTarget,
} from "@/lib/ens-edit";

type EditableRecord = {
  key: string;
  label: string;
  placeholder: string;
  multiline?: boolean;
};

const RECORDS: EditableRecord[] = [
  { key: "name", label: "Display name", placeholder: "SoulVault" },
  { key: "org", label: "Org slug", placeholder: "soulvault" },
  { key: "url", label: "URL", placeholder: "https://soulvault.eth" },
  { key: "description", label: "Description", placeholder: "What this organization does", multiline: true },
  { key: "avatar", label: "Avatar", placeholder: "https://… or upload a file" },
];

export function EditEnsPanel(input: {
  from: Address;
  target: EnsEditTarget;
  /** Normalized org ENS name — required for the ENSv2 pointer repair row. */
  orgName?: string;
  current: Record<string, string>;
  /** Called after each successful save with the records now believed on-chain. */
  onSaved: (updated: Record<string, string>) => void;
}) {
  const { from, target, orgName, current, onSaved } = input;
  const [records, setRecords] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const { key } of RECORDS) initial[key] = current[key] ?? "";
    return initial;
  });
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, `0x${string}`> | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairStatus, setRepairStatus] = useState<string | null>(null);
  const [repairError, setRepairError] = useState<string | null>(null);

  const changes = useMemo(
    () =>
      RECORDS.filter(({ key }) => (records[key] ?? "") !== (current[key] ?? "") && (records[key] ?? "") !== "").map(
        ({ key }) => key,
      ),
    [records, current],
  );

  function setValue(key: string, value: string) {
    setRecords((prev) => ({ ...prev, [key]: value }));
    if (key === "avatar") setAvatarError(validateAvatarValue(value));
  }

  async function onUploadAvatar(file: File | undefined) {
    if (!file) return;
    try {
      const dataUri = await fileToImageDataUri(file);
      setValue("avatar", dataUri);
    } catch (cause) {
      setAvatarError(errorMessage(cause));
    }
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const result = await saveOrgTextRecords({
        from,
        target,
        records,
        current,
      });
      setDone(result.txHashes);
      const skippedCount = RECORDS.length - Object.keys(result.txHashes).length;
      setStatus(
        Object.keys(result.txHashes).length === 0
          ? "Nothing to save — all records already match on-chain."
          : `Saved ${Object.keys(result.txHashes).length} record(s), skipped ${skippedCount}.`,
      );
      // Optimistic update: surface the saved values immediately instead of
      // waiting for the parent's refetch to confirm them.
      const saved: Record<string, string> = {};
      for (const key of Object.keys(result.txHashes)) saved[key] = records[key] ?? "";
      onSaved(saved);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function onRepairPointer() {
    if (!orgName) return;
    setRepairBusy(true);
    setRepairError(null);
    setRepairStatus(null);
    try {
      const result = await repairEnsV2RegistryPointer({ from, orgName });
      setRepairStatus(
        result.txHash
          ? `Pointer written: registry ${result.registry}, owner ${result.owner}.`
          : `Pointer already correct: registry ${result.registry}, owner ${result.owner} — nothing to write.`,
      );
    } catch (cause) {
      setRepairError(errorMessage(cause));
    } finally {
      setRepairBusy(false);
    }
  }

  return (
    <div className="mt-3 max-w-xl border border-border p-4">
      <p className="text-sm font-medium">Edit ENS metadata</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Writes go to{" "}
        <span className="font-mono">
          {target.isV2 ? "the org's PermissionedResolver" : `resolver ${target.resolver}`}
        </span>{" "}
        — one transaction per changed record. Unchanged fields are skipped.
      </p>

      {target.isV2 && orgName ? (
        <div className="mt-3 border border-dashed border-border p-3">
          <p className="text-sm font-medium">ENSv2 pointer repair</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Rewrites the <span className="font-mono">soulvault.ensv2Registry</span> pointer record
            on the org&apos;s resolver so other readers can discover the org registry. Run this if
            the org wizard was interrupted at the mirror step (other flows then fail with
            &ldquo;owner 0x000…0&rdquo;).
          </p>
          <Button
            onClick={() => void onRepairPointer()}
            disabled={repairBusy}
            size="sm"
            variant="outline"
            className="mt-2"
          >
            {repairBusy ? "Waiting for wallet…" : "Repair soulvault.ensv2Registry pointer"}
          </Button>
          {repairStatus ? <p className="mt-2 text-sm text-muted-foreground">{repairStatus}</p> : null}
          {repairError ? (
            <div className="mt-2 border-l-2 border-red-600 pl-3 text-sm text-red-600">{repairError}</div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 grid gap-3">
        {RECORDS.map(({ key, label, placeholder, multiline }) => (
          <label key={key} className="text-sm">
            {label}
            {multiline ? (
              <textarea
                value={records[key] ?? ""}
                onChange={(event) => setValue(key, event.target.value)}
                placeholder={placeholder}
                rows={2}
                className="mt-1 block w-full border border-border bg-card px-2 py-1.5 font-mono text-sm outline-none focus:border-ring"
              />
            ) : (
              <input
                value={records[key] ?? ""}
                onChange={(event) => setValue(key, event.target.value)}
                placeholder={placeholder}
                className="mt-1 block h-8 w-full border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
              />
            )}
            {key === "avatar" ? (
              <span className="mt-1 flex flex-wrap items-center gap-2">
                <label className="inline-flex h-8 cursor-pointer items-center border border-border px-2.5 text-xs">
                  Upload image…
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      void onUploadAvatar(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                {records.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={records.avatar} alt="avatar preview" className="h-10 w-10 border border-border object-cover" />
                ) : null}
              </span>
            ) : null}
          </label>
        ))}
      </div>
      {avatarError ? <p className="mt-2 text-xs text-destructive">{avatarError}</p> : null}

      <Button
        onClick={() => void onSave()}
        disabled={busy || changes.length === 0}
        className="mt-3"
        size="sm"
      >
        {busy ? "Waiting for wallet…" : `Save ${changes.length || ""} change${changes.length === 1 ? "" : "s"}`}
      </Button>
      <DevicePromptPanel />
      {status && !busy ? <p className="mt-2 text-sm text-muted-foreground">{status}</p> : null}
      {done && Object.keys(done).length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs">
          {Object.entries(done).map(([key, hash]) => (
            <li key={key} className="font-mono">
              {key} ✓{" "}
              <a
                className="text-primary underline"
                href={`https://sepolia.etherscan.io/tx/${hash}`}
                target="_blank"
                rel="noreferrer"
              >
                tx {hash.slice(0, 10)}…
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <div className="mt-2 border-l-2 border-red-600 pl-3 text-sm text-red-600">{error}</div>
      ) : null}
    </div>
  );
}
