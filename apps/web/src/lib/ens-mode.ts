// ENSv1/v2 mode resolution for the dashboard wizards.
//
// Resolution order (backwards-compat first):
//   1. Explicit override — localStorage `soulvault.ensModeOverride` = "v1"|"v2"
//      (the manual toggle; wins over everything).
//   2. Auto-detect — the org name's resolver carries a `soulvault.ensv2Registry`
//      pointer record ⇒ v2 (the org is already ENSv2-managed).
//   3. Default — v1 (legacy controller), so existing org flows are untouched.
"use client";

import { detectOrgEnsVersion, type OrgEnsVersion } from "@/lib/ens-register-v2";

export type EnsMode = OrgEnsVersion;
export type EnsModeSource = "override" | "detected" | "default";

const OVERRIDE_KEY = "soulvault.ensModeOverride";

export function getEnsModeOverride(): EnsMode | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    return raw === "v1" || raw === "v2" ? raw : null;
  } catch {
    return null;
  }
}

export function setEnsModeOverride(mode: EnsMode | null): void {
  if (typeof window === "undefined") return;
  try {
    if (mode) window.localStorage.setItem(OVERRIDE_KEY, mode);
    else window.localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // Storage unavailable (private mode) — override simply won't persist.
  }
}

export async function resolveEnsMode(
  orgName: string,
  viewer?: Parameters<typeof detectOrgEnsVersion>[1],
): Promise<{ mode: EnsMode; source: EnsModeSource }> {
  const override = getEnsModeOverride();
  if (override) return { mode: override, source: "override" };
  const detected = await detectOrgEnsVersion(orgName, viewer).catch(() => null);
  if (detected === "v2") return { mode: "v2", source: "detected" };
  return { mode: "v1", source: "default" };
}
