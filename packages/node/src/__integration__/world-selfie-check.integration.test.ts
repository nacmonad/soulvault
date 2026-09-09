import { describe, expect, it } from 'vitest'
import {
  REHYDRATE_REQUEST_ACTION,
  WorldIdentityConfig,
  createMockSelfieCheckVerifier,
  evaluateRehydrateRequest,
  generateRpSignature,
} from '../world-identity.js'

/**
 * PoC integration coverage for the Selfie Check (Beta, credential ID 11)
 * authorization gate on document rehydration requests.
 *
 * Proofs are mocked at the verifier boundary; the verifier interface is the
 * swap point for real Developer Portal verification once the Selfie Check
 * feature flag is enabled for the app.
 */

const requesterWallet = '0xabc0000000000000000000000000000000000001'

function validProof(overrides: Record<string, unknown> = {}) {
  return {
    nullifier: 'nullifier-alice-1',
    credentialId: 11,
    signal: requesterWallet,
    payload: { mock: true },
    ...overrides,
  }
}

describe('RP signature generation', () => {
  it('signs a proof request from the backend signing key', async () => {
    const config = WorldIdentityConfig.parse({
      appId: 'app_test',
      rpId: 'rp_test',
      signingKeyHex: 'a'.repeat(64),
      environment: 'staging',
    })
    const sig = await generateRpSignature(config)
    expect(sig.sig).toBeTruthy()
    expect(sig.nonce).toBeTruthy()
    // expiresAt is a Unix timestamp in seconds (per @worldcoin/idkit-core/signing).
    expect(sig.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects a non-hex signing key', () => {
    expect(() =>
      WorldIdentityConfig.parse({
        appId: 'app_test',
        rpId: 'rp_test',
        signingKeyHex: 'not-hex',
        environment: 'staging',
      }),
    ).toThrow()
  })
})

describe('rehydrate request authorization gate', () => {
  const verifier = createMockSelfieCheckVerifier()

  it('approves a request with a valid Selfie Check proof bound to the requester wallet', async () => {
    const result = await evaluateRehydrateRequest(
      {
        proof: validProof(),
        expectedSignal: requesterWallet,
        consumedNullifiers: new Set(),
      },
      verifier,
    )
    expect(result).toEqual({ approved: true, nullifier: 'nullifier-alice-1' })
  })

  it('rejects a proof bound to a different signal (wallet mismatch)', async () => {
    const result = await evaluateRehydrateRequest(
      {
        proof: validProof({ signal: '0xdead0000000000000000000000000000000009' }),
        expectedSignal: requesterWallet,
        consumedNullifiers: new Set(),
      },
      verifier,
    )
    expect(result).toEqual({ approved: false, reason: 'signal-mismatch' })
  })

  it('rejects a malformed proof payload', async () => {
    const result = await evaluateRehydrateRequest(
      {
        proof: { garbage: true },
        expectedSignal: requesterWallet,
        consumedNullifiers: new Set(),
      },
      verifier,
    )
    expect(result).toEqual({ approved: false, reason: 'malformed-proof' })
  })

  it('rejects an expired proof', async () => {
    const result = await evaluateRehydrateRequest(
      {
        proof: validProof({ nullifier: 'stale-nullifier-expired' }),
        expectedSignal: requesterWallet,
        consumedNullifiers: new Set(),
      },
      verifier,
    )
    expect(result).toEqual({ approved: false, reason: 'proof-expired' })
  })

  it('rejects nullifier replay within the 90-day validity window', async () => {
    const consumed = new Set(['nullifier-alice-1'])
    const result = await evaluateRehydrateRequest(
      {
        proof: validProof(),
        expectedSignal: requesterWallet,
        consumedNullifiers: consumed,
      },
      verifier,
    )
    expect(result).toEqual({ approved: false, reason: 'nullifier-replay' })
  })

  it('rejects a proof from a non-Selfie-Check credential', async () => {
    const result = await evaluateRehydrateRequest(
      {
        proof: validProof({ credentialId: 1 }),
        expectedSignal: requesterWallet,
        consumedNullifiers: new Set(),
      },
      verifier,
    )
    expect(result).toEqual({ approved: false, reason: 'wrong-credential' })
  })

  it('scopes the action constant used for both RP signing and verification', () => {
    // The same action must scope the RP signature and the proof verification
    // so the author's node evaluates exactly what the requester proved.
    expect(REHYDRATE_REQUEST_ACTION).toBe('soulvault-request-rehydrate')
  })
})
