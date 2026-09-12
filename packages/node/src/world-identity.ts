import { signRequest } from '@worldcoin/idkit-core/signing'
import { z } from 'zod'

/**
 * World ID identity layer for Selfie Check (Beta, credential ID 11).
 *
 * Flow: the rehydrate requester presents a Selfie Check proof (liveness +
 * face match) bound to a signal (their wallet address) and an action
 * ("request-rehydrate"). The author's node verifies the proof before
 * approving the request and transmitting the encrypted bundle.
 *
 * The proof is an authorization-time signal (90-day validity), never a
 * stored identity attribute. Nullifiers are persisted per (app, action)
 * to prevent replay by the same World ID account.
 */

export const WorldIdentityConfig = z.object({
  /** `app_id` from the World Developer Portal (app_xxxxx). */
  appId: z.string().min(1),
  /** `rp_id` from World ID 4.0 relying-party registration (rp_xxxxx). */
  rpId: z.string().min(1),
  /** RP signing key hex. Backend-only secret; never expose client-side. */
  signingKeyHex: z.string().regex(/^[0-9a-fA-F]+$/, 'must be hex'),
  /** `staging` for the simulator / sandbox, `production` for live World ID. */
  environment: z.enum(['staging', 'production']),
})

export type WorldIdentityConfig = z.infer<typeof WorldIdentityConfig>

/** The action that scopes Selfie Check proofs in SoulVault. */
export const REHYDRATE_REQUEST_ACTION = 'soulvault-request-rehydrate'

export type RpSignature = Awaited<ReturnType<typeof signRequest>>

/**
 * Generate the backend RP signature for a proof request. The client fetches
 * this (nonce, created_at, expires_at, sig) and embeds it in the IDKit
 * request's rp_context.
 */
export async function generateRpSignature(
  config: WorldIdentityConfig,
  action: string = REHYDRATE_REQUEST_ACTION,
): Promise<RpSignature> {
  return signRequest({
    signingKeyHex: config.signingKeyHex,
    action,
  })
}

/** Minimal Selfie Check proof payload as delivered by IDKit handleVerify. */
export const SelfieProof = z.object({
  /** Per-app, per-action identifier for the verifying World ID account. */
  nullifier: z.string().min(1),
  /** Credential that satisfied the request — Selfie Check is ID 11. */
  credentialId: z.union([z.literal(11), z.number()]),
  /** Context the proof was requested for; backend must enforce this value. */
  signal: z.string().min(1),
  /** Opaque proof material forwarded to the Developer Portal for verification. */
  payload: z.unknown(),
})

export type SelfieProof = z.infer<typeof SelfieProof>

/**
 * Verifier boundary. The PoC ships a mock; production swaps in the
 * Developer Portal verification call once the Selfie Check feature flag
 * is enabled for the app. Kept as an interface so the grant-approval
 * path does not change when the real verifier lands.
 */
export interface SelfieCheckVerifier {
  verify(
    proof: SelfieProof,
    context: { action: string; signal: string },
  ): Promise<{ valid: boolean; reason?: string }>
}

export function createMockSelfieCheckVerifier(
  options: {
    /** Proofs whose signal starts with "fail" are rejected. */
    rejectSignals?: string[]
    /** Proofs whose nullifier starts with "stale" are rejected as expired. */
    rejectExpiredNullifiers?: string[]
  } = {},
): SelfieCheckVerifier {
  const rejectSignals = options.rejectSignals ?? []
  const rejectExpired = options.rejectExpiredNullifiers ?? ['stale']
  return {
    async verify(proof, context) {
      if (proof.credentialId !== 11) {
        return { valid: false, reason: 'wrong-credential' }
      }
      if (rejectSignals.some((s) => context.signal.startsWith(s))) {
        return { valid: false, reason: 'verification-failed' }
      }
      if (rejectExpired.some((p) => proof.nullifier.startsWith(p))) {
        return { valid: false, reason: 'proof-expired' }
      }
      return { valid: true }
    },
  }
}

export type RehydrateRequestEvaluation =
  | { approved: true; nullifier: string }
  | { approved: false; reason: string }

/**
 * Gate a document rehydration request on a verified Selfie Check proof.
 *
 * Checks, in order:
 *  1. Proof shape and signal binding (backend enforces the same signal the
 *     client bound into the proof — typically the requester wallet address).
 *  2. Cryptographic verification through the verifier boundary.
 *  3. Nullifier replay: the same World ID account may not re-verify for the
 *     same action within the 90-day credential validity window.
 */
export async function evaluateRehydrateRequest(
  input: {
    proof: unknown
    /** Expected signal — e.g. `lower(wallet):docHash`. */
    expectedSignal: string
    /** Nullifiers already consumed for this action (90-day window). */
    consumedNullifiers?: ReadonlySet<string>
    /** UNIQUE(action, nullifier) store. Insert returns false on duplicate. */
    nullifierStore?: NullifierStore
  },
  verifier: SelfieCheckVerifier,
): Promise<RehydrateRequestEvaluation> {
  const parsed = selfieProofFromUnknown(input.proof, input.expectedSignal)
  if (!parsed) {
    return { approved: false, reason: 'malformed-proof' }
  }
  const proof = parsed
  if (proof.signal.toLowerCase() !== input.expectedSignal.toLowerCase()) {
    return { approved: false, reason: 'signal-mismatch' }
  }
  const result = await verifier.verify(proof, {
    action: REHYDRATE_REQUEST_ACTION,
    signal: input.expectedSignal,
  })
  if (!result.valid) {
    return { approved: false, reason: result.reason ?? 'verification-failed' }
  }
  if (input.nullifierStore) {
    if (!input.nullifierStore.insert(REHYDRATE_REQUEST_ACTION, proof.nullifier)) {
      return { approved: false, reason: 'nullifier-replay' }
    }
  } else if (input.consumedNullifiers?.has(proof.nullifier)) {
    return { approved: false, reason: 'nullifier-replay' }
  }
  return { approved: true, nullifier: proof.nullifier }
}

/** Bind Charlie's wallet to the document he is requesting. */
export function rehydrateSelfieSignal(wallet: string, docHash: string): string {
  const addr = wallet.trim().toLowerCase()
  const hash = docHash.trim().toLowerCase()
  const withPrefix = hash.startsWith('0x') ? hash : `0x${hash}`
  return `${addr}:${withPrefix}`
}

const SELFIE_IDENTIFIERS = new Set(['selfie', 'face'])

/**
 * Accept either the compact SelfieProof shape or a raw IDKit result
 * (`protocol_version` 3.0, `responses[].identifier: "selfie"`).
 */
export function selfieProofFromUnknown(
  raw: unknown,
  fallbackSignal: string,
): SelfieProof | null {
  if (!raw || typeof raw !== 'object') return null
  const direct = SelfieProof.safeParse(raw)
  if (direct.success) return direct.data

  const value = raw as {
    nullifier?: unknown
    credentialId?: unknown
    signal?: unknown
    payload?: unknown
    responses?: unknown
  }
  const responses = Array.isArray(value.responses) ? value.responses : []
  const selfie = responses.find((row) => {
    if (!row || typeof row !== 'object') return false
    const id = (row as { identifier?: unknown }).identifier
    return typeof id === 'string' && SELFIE_IDENTIFIERS.has(id.toLowerCase())
  }) as { identifier?: string; nullifier?: unknown } | undefined

  const nullifier =
    typeof value.nullifier === 'string'
      ? value.nullifier
      : typeof selfie?.nullifier === 'string'
        ? selfie.nullifier
        : ''
  if (!nullifier) return null

  const signal =
    typeof value.signal === 'string' && value.signal.length > 0
      ? value.signal
      : fallbackSignal
  if (!signal) return null

  const credentialId =
    typeof value.credentialId === 'number'
      ? value.credentialId
      : selfie
        ? 11
        : NaN
  if (!Number.isInteger(credentialId) || credentialId !== 11) return null

  return {
    nullifier,
    credentialId,
    signal,
    payload: value.payload ?? raw,
  }
}

/** UNIQUE(action, nullifier). Insert returns false on duplicate — no upsert. */
export interface NullifierStore {
  insert(action: string, nullifier: string): boolean
}

export class MemoryNullifierStore implements NullifierStore {
  #keys = new Set<string>()
  insert(action: string, nullifier: string): boolean {
    const k = `${action}\0${nullifier}`
    if (this.#keys.has(k)) return false
    this.#keys.add(k)
    return true
  }
}

const DEFAULT_VERIFY_BASE = 'https://developer.world.org/api/v4/verify'

export type PortalVerifyFetch = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/**
 * Forwards the IDKit result **as-is** to Portal verify. Fail closed.
 * Does not log bodies.
 */
export function createPortalSelfieCheckVerifier(opts: {
  rpId: string
  fetchImpl?: PortalVerifyFetch
  verifyBase?: string
}): SelfieCheckVerifier {
  const rpId = opts.rpId.trim()
  if (!rpId.startsWith('rp_')) {
    throw new Error('rpId must be a public rp_… id')
  }
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as PortalVerifyFetch)
  const url = `${opts.verifyBase ?? DEFAULT_VERIFY_BASE}/${encodeURIComponent(rpId)}`
  return {
    async verify(proof, context) {
      if (proof.credentialId !== 11) {
        return { valid: false, reason: 'wrong-credential' }
      }
      const body = JSON.stringify(proof.payload ?? proof)
      if (/signingKey|RP_SIGNING_KEY|WORLD_RP_SIGNING_KEY/i.test(body)) {
        return { valid: false, reason: 'secret-in-payload' }
      }
      let res: { ok: boolean; status: number; json: () => Promise<unknown> }
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
      } catch {
        return { valid: false, reason: 'verifier-unreachable' }
      }
      if (!res.ok) return { valid: false, reason: 'verification-failed' }
      let parsed: unknown
      try {
        parsed = await res.json()
      } catch {
        return { valid: false, reason: 'malformed-verifier-response' }
      }
      const row = parsed as { success?: boolean; action?: string }
      if (row.success !== true) return { valid: false, reason: 'verification-failed' }
      if (row.action && row.action !== context.action) {
        return { valid: false, reason: 'action-mismatch' }
      }
      return { valid: true }
    },
  }
}
