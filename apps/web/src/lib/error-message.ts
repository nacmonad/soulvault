/**
 * Extract a human-readable message from anything thrown across the wallet,
 * DMK (Ledger), viem, and EIP-1193 boundaries. Those layers reject with plain
 * objects (`{code, message}`, `{_tag, errorCode}`) as often as Error
 * instances — `e instanceof Error` checks lose the payload and render
 * "[object Object]". Used by every wizard catch block and the wallet provider.
 */
export function errorMessage(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) {
    // The message alone loses the origin (e.g. a TypeError thrown inside a
    // dependency surfaces as an opaque sentence) — always leave the full stack
    // in the console for debugging.
    if (cause.stack) console.error("[soulvault] error (full stack):\n" + cause.stack);
    return cause.message || cause.name;
  }
  if (!cause || typeof cause !== "object") return String(cause);
  const e = cause as Record<string, unknown>;
  // Non-Error payloads (DMK plain objects) are logged raw so no shape is lost.
  console.error("[soulvault] non-Error rejection:", cause);
  const message = [e.message, e.shortMessage, e.reason].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const tag = typeof e._tag === "string" && e._tag ? e._tag : null;
  const code = e.errorCode ?? e.code;
  const details = [
    tag ? `tag ${tag}` : null,
    code !== undefined && code !== null && code !== "" ? `code ${code}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  if (message && details) return `${message} (${details})`;
  if (message) return message;
  if (details) return details;
  try {
    const json = JSON.stringify(cause);
    return json.length > 300 ? `${json.slice(0, 300)}…` : json;
  } catch {
    return String(cause);
  }
}

/** Mark any in-flight wizard step failed — a rejected flow must not leave "…" spinning. */
export function wizardStepFailed<T extends { status: string }>(step: T): T {
  return step.status === "signing" || step.status === "mining" ? { ...step, status: "failed" as const } : step;
}
