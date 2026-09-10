/**
 * Browser-side RPC endpoint override (ticket 010).
 *
 * Stored in localStorage so an operator can point the dashboard at a personal
 * token endpoint / dedicated node / local node without rebuilding the static
 * export. Precedence: override → NEXT_PUBLIC_SOULVAULT_RPC_URL.
 *
 * A value may be a single http(s) URL or a comma-separated list — the list is
 * passed to viem's fallback transport so a rate-limited (429) provider
 * automatically hands off to the next one, in the configured order.
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

/** Split a comma-separated endpoint list into valid, deduped http(s) URLs. */
export function parseRpcUrlList(candidate: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of candidate.split(",")) {
    const normalized = validate(part.trim());
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
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

/** Returns null when no comma-separated entry is a valid http(s) URL. */
export function setRpcUrlOverride(candidate: string): string | null {
  const urls = parseRpcUrlList(candidate);
  if (urls.length === 0) return null;
  const joined = urls.join(",");
  window.localStorage.setItem(STORAGE_KEY, joined);
  return joined;
}

export function clearRpcUrlOverride(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
