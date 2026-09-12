/**
 * Browser-side transaction-fee settings (localStorage).
 *
 * `soulvault.eip1559` controls whether the browser wallet channel prepares
 * EIP-1559 (type-2) transactions — maxFeePerGas/maxPriorityFeePerGas from the
 * RPC's fee estimate — instead of legacy type-0 txs priced from a single
 * eth_gasPrice snapshot. 1559 is the default: a legacy tx priced at the last
 * gas-price snapshot lands with ~zero priority tip when the Sepolia base fee
 * rises, and then sits in the mempool until the base fee decays back — the
 * classic "my tx took minutes" case.
 *
 * Scope: both signing channels. The injected-wallet channel prices the tx
 * with the 1559 fields; the Ledger channel (ledger-tx.ts) signs a type-2
 * payload the same way and falls back to a legacy type-0 tx automatically when
 * the device rejects the typed payload with 6a80 — so the setting degrades
 * gracefully instead of bricking Ledger signing.
 */
const STORAGE_KEY = "soulvault.eip1559";

/**
 * On by default: an absent key means enabled, so fresh browsers get 1559
 * without touching settings. Only an explicit "0" disables.
 */
export function getEip1559Enabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setEip1559Enabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    // Store "0" for off; drop the key entirely for on so the default and the
    // explicit value stay indistinguishable.
    if (enabled) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, "0");
  } catch {
    // localStorage unavailable (private mode, SSR) — nothing to persist.
  }
}
