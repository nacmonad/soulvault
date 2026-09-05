"use client";

import { useMemo, useSyncExternalStore } from "react";
import { createSpeculosTransport } from "@soulvault/dmk-speculos-browser";
import {
  SoulVaultLedgerProvider,
  useSoulVaultWallet,
} from "@/components/providers/soulvault-ledger-provider";

export default function LedgerSpeculosProofPage() {
  if (process.env.NODE_ENV === "production") {
    return <main>Speculos proof is unavailable in production.</main>;
  }
  return <DevelopmentProof />;
}

function DevelopmentProof() {
  const location = useSyncExternalStore(
    () => () => undefined,
    () => window.location.href,
    () => undefined,
  );
  const apduUrl = location ? new URL(location).searchParams.get("apduUrl") : undefined;
  const registration = useMemo(() => apduUrl
    ? createSpeculosTransport({ apduUrl, requestTimeoutMs: 120_000 })
    : undefined, [apduUrl]);
  if (location && !apduUrl) return <main>Missing the development-only apduUrl query parameter.</main>;
  if (!registration) return <main>Preparing development Ledger transport…</main>;
  return (
    <SoulVaultLedgerProvider developmentLedgerTransport={{
      factory: registration.factory,
      identifier: registration.identifier,
      emulated: true,
    }}>
      <ProofSignIn />
    </SoulVaultLedgerProvider>
  );
}

function ProofSignIn() {
  const { address, status, error, connectLedger, disconnect } = useSoulVaultWallet();
  return (
    <main style={{ fontFamily: "sans-serif", margin: "4rem auto", maxWidth: 640 }}>
      <p data-testid="evidence-label">
        Speculos emulation proves browser integration and device-action handling;
        it does not prove WebHID discovery, physical possession, or hardware attestation.
      </p>
      <button type="button" onClick={() => void connectLedger()} disabled={status === "connecting"}>
        Sign in with Ledger
      </button>
      <p data-testid="wallet-status">{status}</p>
      {address ? <p data-testid="wallet-address">{address}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {address ? <button type="button" onClick={() => void disconnect()}>Disconnect</button> : null}
    </main>
  );
}
