"use client";

import { useEffect, useState, type PropsWithChildren } from "react";

import { SoulVaultLedgerProvider, type DevelopmentLedgerTransport } from "@/components/providers/soulvault-ledger-provider";
import { SoulVaultEventsProvider } from "@/context/SoulVaultEventsProvider";

/**
 * Test-only wiring (ticket 006): when the page URL carries `apduUrl`, the
 * dashboard's Ledger connector registers the Speculos emulated transport
 * in place of WebHID — the same pattern as /ledger-speculos-proof, but applied
 * to the whole dashboard so e2e suites can drive real flows through the
 * connect panel. The import is dynamic and gated on a dev server OR a
 * dedicated e2e build (SOULVAULT_WEB_E2E=1 at build time), so regular
 * production builds dead-code-eliminate the emulation package entirely.
 */
export function AppProviders({ children }: PropsWithChildren) {
  const [developmentLedgerTransport, setDevelopmentLedgerTransport] = useState<DevelopmentLedgerTransport>();
  useEffect(() => {
    const gate = process.env.NODE_ENV !== "production" || process.env.SOULVAULT_WEB_E2E === "1";
    if (!gate) return;
    const apduUrl = new URLSearchParams(window.location.search).get("apduUrl");
    if (!apduUrl) return;
    let cancelled = false;
    void import("@soulvault/dmk-speculos-browser").then(({ createSpeculosTransport }) => {
      if (cancelled) return;
      const registration = createSpeculosTransport({ apduUrl, requestTimeoutMs: 120_000 });
      setDevelopmentLedgerTransport({
        factory: registration.factory,
        identifier: registration.identifier,
        emulated: true,
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  return (
    <SoulVaultLedgerProvider developmentLedgerTransport={developmentLedgerTransport}>
      <SoulVaultEventsProvider>{children}</SoulVaultEventsProvider>
    </SoulVaultLedgerProvider>
  );
}
