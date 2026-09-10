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

/**
 * Best-effort read of the selected org ENS name without knowing the wallet:
 * scans the per-wallet dashboard-selection keys. Used by non-React callers
 * (e.g. document-registry root-name resolution). Null when nothing selected.
 */
export function loadSelectedOrgEnsName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith("soulvault.dashboard.context.")) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Partial<DashboardSelection>;
      if (typeof parsed.orgId === "string" && parsed.orgId) return parsed.orgId;
    }
  } catch {
    return null;
  }
  return null;
}
