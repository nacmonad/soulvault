/**
 * Clear-signing mode + error taxonomy shared between the Ledger signer,
 * typed-data flows, and the Speculos/hardware integration suites.
 *
 * Spec: docs/clear-signing-spec.md §2-§3
 */

export type ClearSignMode = 'strict-clear-sign' | 'clear-sign-preferred' | 'blind-only';

export type ClearSignErrorCode =
  | 'UNSUPPORTED_SELECTOR'
  | 'CLEAR_SIGN_CONTEXT_FETCH_FAILED'
  | 'USER_REJECTED'
  | 'APP_INCOMPATIBLE'
  | 'INVALID_DATA'
  | 'TIMEOUT'
  | 'COMMUNICATION';

export class ClearSignError extends Error {
  readonly code: ClearSignErrorCode;
  readonly apduCode: string | undefined;
  readonly cause?: unknown;

  constructor(code: ClearSignErrorCode, message: string, opts?: { apduCode?: string; cause?: unknown }) {
    super(message);
    this.name = 'ClearSignError';
    this.code = code;
    this.apduCode = opts?.apduCode;
    this.cause = opts?.cause;
  }
}

/** Map an APDU status word to a ClearSignError code, or undefined if not a known signing failure. */
export function apduToClearSignCode(apdu: string | undefined): ClearSignErrorCode | undefined {
  if (!apdu) return undefined;
  const c = apdu.toLowerCase();
  switch (c) {
    case '6985': return 'USER_REJECTED';
    case '6a80': return 'INVALID_DATA';
    case '6a87': return 'INVALID_DATA';
    case '6d00':
    case '6e00':
    case '6511': return 'APP_INCOMPATIBLE';
    default: return undefined;
  }
}

export interface SignTransactionOptions {
  /** Override the env-default clear-sign mode for this call. */
  clearSign?: ClearSignMode;
}

export interface SignTypedDataOptions {
  /** Typed-data clear-sign is always attempted; this flag only controls strictness on filter availability. */
  clearSign?: Extract<ClearSignMode, 'strict-clear-sign' | 'clear-sign-preferred'>;
}
