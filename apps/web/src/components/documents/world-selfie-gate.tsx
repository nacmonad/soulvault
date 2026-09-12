"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  evaluateSelfieProof,
  parsePastedSelfieProof,
  RehydrateGateError,
  type WorldRehydrateGate,
} from "@/lib/document-rehydrate";

type RpContext = {
  rp_id: string;
  nonce: string;
  created_at: number;
  expires_at: number;
  signature: string;
};

type IdkitModule = typeof import("@worldcoin/idkit");

let idkitPromise: Promise<IdkitModule> | null = null;

function loadIdkit() {
  if (!idkitPromise) idkitPromise = import("@worldcoin/idkit");
  return idkitPromise;
}

export function WorldSelfieGate(props: {
  world: Extract<WorldRehydrateGate, { mode: "required" }>;
  signal: string;
  selfieOk: boolean;
  onVerified: (nullifier: string, proofJson: string) => void;
  onError: (message: string) => void;
}) {
  const { world, signal, selfieOk, onVerified, onError } = props;
  const [proofText, setProofText] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [Idkit, setIdkit] = useState<IdkitModule | null>(null);

  async function openIdkit() {
    if (!world.rpUrl || !world.rpId) {
      onError("World RP worker URL / rp_id unset. Start `soulvault world rp-server` or use the staging fixture.");
      return;
    }
    setBusy(true);
    try {
      const idkit = await loadIdkit();
      setIdkit(idkit);
      const res = await fetch(`${world.rpUrl}/rp-signature`);
      const body = (await res.json()) as {
        error?: string;
        rp_id?: string;
        nonce?: string;
        created_at?: number;
        expires_at?: number;
        sig?: string;
      };
      if (res.status === 503 || body.error === "rp-signing-unconfigured") {
        onError("RP signing key is not on the worker yet. Use the staging fixture, or wait for the owner to place WORLD_RP_SIGNING_KEY.");
        return;
      }
      if (!res.ok || !body.sig || !body.nonce || body.created_at == null || body.expires_at == null) {
        onError("RP signature failed.");
        return;
      }
      setRpContext({
        rp_id: body.rp_id || world.rpId,
        nonce: body.nonce,
        created_at: body.created_at,
        expires_at: body.expires_at,
        signature: body.sig,
      });
      setOpen(true);
    } catch {
      onError("Could not reach the World RP worker.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(result: unknown) {
    if (!world.rpUrl) throw new Error("RP worker unset");
    const res = await fetch(`${world.rpUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedSignal: signal, idkitResponse: result }),
    });
    const body = (await res.json()) as { approved?: boolean; nullifier?: string; reason?: string };
    if (!body.approved || !body.nullifier) {
      throw new Error(body.reason ? `Selfie Check failed (${body.reason}).` : "Selfie Check failed.");
    }
    onVerified(body.nullifier, JSON.stringify(result));
  }

  function presentFixture() {
    try {
      const result = evaluateSelfieProof({
        proof: parsePastedSelfieProof(proofText),
        expectedSignal: signal,
        consumedNullifiers: new Set(),
      });
      if (!result.ok) {
        throw new RehydrateGateError("SELFIE_REJECTED", `Selfie Check failed (${result.reason}).`);
      }
      onVerified(result.nullifier, proofText.trim());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Selfie Check failed.");
    }
  }

  const Widget = Idkit?.IDKitRequestWidget;
  const preset = Idkit?.selfieCheckLegacy;

  return (
    <div className="mt-4 border border-border bg-card p-4">
      <p className="text-sm font-medium">World Selfie Check</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Present credential 11 before <span className="font-medium">Request rehydration</span>. Unwrap is
        not gated. Scope: {world.appId} / {world.action}
        {world.rpId ? ` / ${world.rpId}` : ""}.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void openIdkit()} disabled={selfieOk || busy || !signal}>
          {selfieOk ? "Selfie Check verified" : busy ? "Opening World ID…" : "Verify with World ID"}
        </Button>
      </div>
      {Widget && preset && rpContext ? (
        <Widget
          open={open}
          onOpenChange={setOpen}
          app_id={world.appId as `app_${string}`}
          action={world.action}
          environment={world.environment}
          allow_legacy_proofs
          rp_context={rpContext}
          preset={preset({ signal })}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code) => onError(`World ID error: ${String(code)}`)}
        />
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-muted-foreground">Staging fixture (paste JSON)</summary>
        <textarea
          value={proofText}
          onChange={(event) => setProofText(event.target.value)}
          placeholder='{"nullifier":"…","credentialId":11,"signal":"0x…:0x…"}'
          className="mt-3 min-h-24 w-full border border-border bg-background p-3 font-mono text-xs outline-none focus:border-ring"
          aria-label="Selfie Check proof JSON fixture"
        />
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={presentFixture} disabled={selfieOk || !signal}>
            Present fixture
          </Button>
        </div>
      </details>
    </div>
  );
}
