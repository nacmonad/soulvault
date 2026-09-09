"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import {
  loadDashboardSelection,
  saveDashboardSelection,
  type DashboardSelection,
} from "@/lib/dashboard-context";

const empty: DashboardSelection = { orgId: null, swarmId: null, rememberedOrgs: [] };

type DashboardSelectionContextValue = {
  selection: DashboardSelection;
  setOrg: (orgId: string | null) => void;
  setSwarm: (swarmId: string | null) => void;
  rememberOrg: (name: string) => void;
};

const DashboardSelectionContext = createContext<DashboardSelectionContextValue | null>(null);

export function DashboardSelectionProvider({ children }: { children: React.ReactNode }) {
  const { address } = useSoulVaultWallet();
  const [selection, setSelection] = useState<DashboardSelection>(empty);

  useEffect(() => {
    if (!address) {
      setSelection(empty);
      return;
    }
    setSelection(loadDashboardSelection(address));
  }, [address]);

  const persist = useCallback(
    (next: DashboardSelection) => {
      setSelection(next);
      if (address) saveDashboardSelection(address, next);
    },
    [address],
  );

  const setOrg = useCallback(
    (orgId: string | null) => persist({ ...selection, orgId }),
    [persist, selection],
  );

  const setSwarm = useCallback(
    (swarmId: string | null) => persist({ ...selection, swarmId }),
    [persist, selection],
  );

  const rememberOrg = useCallback(
    (name: string) => {
      const normalized = name.trim().toLowerCase();
      if (!normalized) return;
      const rememberedOrgs = selection.rememberedOrgs.includes(normalized)
        ? selection.rememberedOrgs
        : [...selection.rememberedOrgs, normalized];
      persist({ ...selection, orgId: normalized, rememberedOrgs });
    },
    [persist, selection],
  );

  const value = useMemo(
    () => ({ selection, setOrg, setSwarm, rememberOrg }),
    [selection, setOrg, setSwarm, rememberOrg],
  );

  return (
    <DashboardSelectionContext.Provider value={value}>{children}</DashboardSelectionContext.Provider>
  );
}

export function useDashboardSelection() {
  const ctx = useContext(DashboardSelectionContext);
  if (!ctx) throw new Error("useDashboardSelection requires DashboardSelectionProvider");
  return ctx;
}
