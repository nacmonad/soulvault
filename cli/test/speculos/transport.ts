/**
 * DMK transport adapter for Speculos.
 *
 * Speculos exposes APDUs on `POST /apdu` (request body: hex APDU; response body:
 * hex APDU). DMK's signer-kit expects a `TransportFactory` implementing the
 * `@ledgerhq/device-management-kit` Transport contract. The cleanest path is
 * the official `@ledgerhq/device-transport-kit-speculos` package; at time of
 * writing this repo has not added that dependency.
 *
 * Two wire-ups supported:
 *
 *   1. If `@ledgerhq/device-transport-kit-speculos` is present → use it.
 *   2. Else → use a low-level `apduExchange()` helper below. Tests that need
 *      full SignerEth behavior route APDUs manually through this exchanger
 *      (see `signer-speculos.ts`).
 *
 * The second path is sufficient for: raw EIP-712 signing, raw transaction
 * signing, getAddress. It is *not* a drop-in for the high-level SignerEth
 * (which handles CAL context pushing). For full CAL integration in Speculos,
 * install the speculos transport kit — see docs/clear-signing-runbook.md §4.
 */

export interface ApduExchangeOptions {
  apiUrl: string;
  apdu: Uint8Array | string;
}

/** Send a raw APDU to speculos and return the reply bytes. */
export async function apduExchange({ apiUrl, apdu }: ApduExchangeOptions): Promise<Uint8Array> {
  const hex = typeof apdu === 'string' ? apdu : Buffer.from(apdu).toString('hex');
  const res = await fetch(`${apiUrl}/apdu`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: hex }),
  });
  if (!res.ok) throw new Error(`Speculos /apdu ${res.status}: ${await res.text().catch(() => '')}`);
  const body = (await res.json()) as { data?: string };
  if (!body.data) throw new Error('Speculos /apdu returned no data');
  return Buffer.from(body.data, 'hex');
}

/** Attempt to import the official speculos DMK transport kit; return undefined if unavailable. */
export async function loadSpeculosTransportKit(): Promise<unknown | undefined> {
  try {
    // dynamic import so missing dep does not crash the test file's top-level
    const mod = await import('@ledgerhq/device-transport-kit-speculos' as string);
    return mod;
  } catch {
    return undefined;
  }
}
