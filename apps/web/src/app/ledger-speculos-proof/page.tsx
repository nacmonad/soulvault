"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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
  const eventsUrl = location ? new URL(location).searchParams.get("eventsUrl") : undefined;
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
      <ProofSignIn eventsUrl={eventsUrl ?? undefined} />
    </SoulVaultLedgerProvider>
  );
}

function ProofSignIn({ eventsUrl }: { eventsUrl?: string }) {
  const { address, status, error, connectLedger, disconnect } = useSoulVaultWallet();
  const [deviceScreen, setDeviceScreen] = useState("Waiting for Speculos…");
  useEffect(() => {
    if (!eventsUrl) return;
    let active = true;
    const poll = async () => {
      try {
        const response = await fetch(eventsUrl);
        const payload = await response.json() as { events?: Array<{ text?: string }> };
        const text = payload.events?.map((event) => event.text).filter(Boolean).join(" · ");
        if (active && text) setDeviceScreen(text);
      } catch {
        if (active) setDeviceScreen("Speculos view unavailable");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 150);
    return () => { active = false; window.clearInterval(timer); };
  }, [eventsUrl]);
  return (
    <main style={{ fontFamily: "sans-serif", margin: "3rem auto", maxWidth: 1000, padding: "0 2rem" }}>
      <h1>Ledger browser sign-in proof</h1>
      <p data-testid="evidence-label" style={{ color: "#555" }}>
        Speculos emulation proves browser integration and device-action handling;
        it does not prove WebHID discovery, physical possession, or hardware attestation.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", alignItems: "center" }}>
        <section style={{ border: "1px solid #ddd", borderRadius: 16, padding: "2rem" }}>
          <h2>SoulVault</h2>
          <button type="button" onClick={() => void connectLedger()} disabled={status === "connecting"} style={{ fontSize: 18, padding: "0.8rem 1.2rem" }}>
            {status === "connecting" ? "Confirm on Ledger…" : "Sign in with Ledger"}
          </button>
          <p>Status: <strong data-testid="wallet-status">{status}</strong></p>
          {address ? <p data-testid="wallet-address" style={{ overflowWrap: "anywhere" }}>{address}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
          {address ? <button type="button" onClick={() => void disconnect()}>Disconnect</button> : null}
        </section>
        <section aria-label="Speculos device view" style={{ background: "#111", borderRadius: 28, padding: "2rem", color: "white", textAlign: "center" }}>
          <p style={{ color: "#aaa", marginTop: 0 }}>SPECULOS · NANO S PLUS</p>
          <div data-testid="device-screen" style={{ background: "#050505", border: "2px solid #555", borderRadius: 8, minHeight: 96, padding: "1.5rem 1rem", display: "grid", placeItems: "center", fontFamily: "monospace", fontSize: 18 }}>
            {deviceScreen}
          </div>
          <p style={{ color: "#aaa", marginBottom: 0 }}>Live screen events from the emulated Ledger</p>
        </section>
      </div>
    </main>
  );
}
