/**
 * Browser-side RPC endpoint override (ticket 010).
 *
 * Stored in localStorage so an operator can point the dashboard at a personal
 * token endpoint / dedicated node / local node without rebuilding the static
 * export. Precedence: override → NEXT_PUBLIC_SOULVAULT_RPC_URL.
 */
const STORAGE_KEY = "soulvault.rpcUrlOverride";

function validate(candidate: string): string | null {
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function getRpcUrlOverride(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return validate(raw);
  } catch {
    return null;
  }
}

/** Returns null when the candidate is not a valid http(s) URL. */
export function setRpcUrlOverride(candidate: string): string | null {
  const normalized = validate(candidate.trim());
  if (!normalized) return null;
  window.localStorage.setItem(STORAGE_KEY, normalized);
  return normalized;
}

export function clearRpcUrlOverride(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
