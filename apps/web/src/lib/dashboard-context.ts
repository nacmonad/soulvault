import type { Address } from "viem";

export type DashboardSelection = {
  orgId: string | null;
  swarmId: string | null;
};

const empty: DashboardSelection = { orgId: null, swarmId: null };

function storageKey(wallet: Address) {
  return `soulvault.dashboard.context.${wallet.toLowerCase()}`;
}

export function loadDashboardSelection(wallet: Address): DashboardSelection {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(storageKey(wallet));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<DashboardSelection>;
    return {
      orgId: typeof parsed.orgId === "string" && parsed.orgId ? parsed.orgId : null,
      swarmId: typeof parsed.swarmId === "string" && parsed.swarmId ? parsed.swarmId : null,
    };
  } catch {
    return empty;
  }
}

export function saveDashboardSelection(wallet: Address, selection: DashboardSelection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(wallet), JSON.stringify(selection));
}
