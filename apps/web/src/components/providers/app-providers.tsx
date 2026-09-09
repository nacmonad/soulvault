"use client";

import type { PropsWithChildren } from "react";

import { SoulVaultLedgerProvider } from "@/components/providers/soulvault-ledger-provider";
import { SoulVaultEventsProvider } from "@/context/SoulVaultEventsProvider";

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <SoulVaultLedgerProvider>
      <SoulVaultEventsProvider>{children}</SoulVaultEventsProvider>
    </SoulVaultLedgerProvider>
  );
}
