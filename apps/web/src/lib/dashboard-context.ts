import type { Address } from "viem";

export type DashboardSelection = {
  orgId: string | null;
  swarmId: string | null;
  rememberedOrgs: string[];
};

const empty: DashboardSelection = { orgId: null, swarmId: null, rememberedOrgs: [] };

function storageKey(wallet: Address) {
  return `soulvault.dashboard.context.${wallet.toLowerCase()}`;
}

export function loadDashboardSelection(wallet: Address): DashboardSelection {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(storageKey(wallet));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<DashboardSelection>;
    const rememberedOrgs = Array.isArray(parsed.rememberedOrgs)
      ? parsed.rememberedOrgs.filter((name): name is string => typeof name === "string" && name.length > 0)
      : [];
    return {
      orgId: typeof parsed.orgId === "string" && parsed.orgId ? parsed.orgId : null,
      swarmId: typeof parsed.swarmId === "string" && parsed.swarmId ? parsed.swarmId : null,
      rememberedOrgs,
    };
  } catch {
    return empty;
  }
}

export function saveDashboardSelection(wallet: Address, selection: DashboardSelection) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey(wallet), JSON.stringify(selection));
}
