"use client";
import type { PropsWithChildren } from "react";
import { SoulVaultLedgerProvider } from "@/components/providers/soulvault-ledger-provider";
export function AppProviders({ children }: PropsWithChildren) { return <SoulVaultLedgerProvider>{children}</SoulVaultLedgerProvider>; }
