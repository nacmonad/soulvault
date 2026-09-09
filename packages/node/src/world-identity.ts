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
    /** Expected signal — e.g. the requester wallet address from the request. */
    expectedSignal: string
    /** Nullifiers already consumed for this action (90-day window). */
    consumedNullifiers: ReadonlySet<string>
  },
  verifier: SelfieCheckVerifier,
): Promise<RehydrateRequestEvaluation> {
  const parsed = SelfieProof.safeParse(input.proof)
  if (!parsed.success) {
    return { approved: false, reason: 'malformed-proof' }
  }
  const proof = parsed.data
  if (proof.signal !== input.expectedSignal) {
    return { approved: false, reason: 'signal-mismatch' }
  }
  const result = await verifier.verify(proof, {
    action: REHYDRATE_REQUEST_ACTION,
    signal: input.expectedSignal,
  })
  if (!result.valid) {
    return { approved: false, reason: result.reason ?? 'verification-failed' }
  }
  if (input.consumedNullifiers.has(proof.nullifier)) {
    return { approved: false, reason: 'nullifier-replay' }
  }
  return { approved: true, nullifier: proof.nullifier }
}
