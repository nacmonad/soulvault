import { describe, expect, it } from 'vitest'
import {
  MemoryNullifierStore,
  REHYDRATE_REQUEST_ACTION,
  createMockSelfieCheckVerifier,
  createPortalSelfieCheckVerifier,
  evaluateRehydrateRequest,
  rehydrateSelfieSignal,
  selfieProofFromUnknown,
} from './world-identity.js'

const wallet = '0xABC0000000000000000000000000000000000001'
const docHash = '0x' + 'ab'.repeat(32)

describe('rehydrateSelfieSignal', () => {
  it('lowercases wallet and docHash', () => {
    expect(rehydrateSelfieSignal(wallet, docHash.toUpperCase())).toBe(
      `${wallet.toLowerCase()}:${docHash}`,
    )
  })
})

describe('selfieProofFromUnknown', () => {
  it('reads compact proofs', () => {
    const proof = selfieProofFromUnknown(
      { nullifier: 'n1', credentialId: 11, signal: 's', payload: { x: 1 } },
      's',
    )
    expect(proof?.nullifier).toBe('n1')
    expect(proof?.credentialId).toBe(11)
  })

  it('reads IDKit 3.0 selfie responses without remapping identifier', () => {
    const idkit = {
      protocol_version: '3.0',
      action: REHYDRATE_REQUEST_ACTION,
      responses: [
        { identifier: 'selfie', nullifier: '0xabc', proof: '0xproof', merkle_root: '0xroot' },
      ],
    }
    const proof = selfieProofFromUnknown(idkit, 'sig')
    expect(proof).toMatchObject({ nullifier: '0xabc', credentialId: 11, signal: 'sig' })
    expect(proof?.payload).toEqual(idkit)
  })

  it('rejects orb-only IDKit results', () => {
    expect(
      selfieProofFromUnknown(
        { responses: [{ identifier: 'orb', nullifier: '0x1' }] },
        'sig',
      ),
    ).toBeNull()
  })
})

describe('createPortalSelfieCheckVerifier', () => {
  it('forwards the IDKit payload as-is', async () => {
    const idkit = {
      protocol_version: '3.0',
      action: REHYDRATE_REQUEST_ACTION,
      responses: [{ identifier: 'selfie', nullifier: 'n1' }],
    }
    let forwarded = ''
    const verifier = createPortalSelfieCheckVerifier({
      rpId: 'rp_test',
      fetchImpl: async (_url, init) => {
        forwarded = init.body
        return { ok: true, status: 200, json: async () => ({ success: true }) }
      },
    })
    const proof = selfieProofFromUnknown(idkit, 'sig')!
    const result = await verifier.verify(proof, { action: REHYDRATE_REQUEST_ACTION, signal: 'sig' })
    expect(result).toEqual({ valid: true })
    expect(JSON.parse(forwarded)).toEqual(idkit)
    expect(forwarded).not.toMatch(/signingKey/i)
  })

  it('fails closed when portal returns success:false', async () => {
    const verifier = createPortalSelfieCheckVerifier({
      rpId: 'rp_test',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: false, code: 'verification_failed' }),
      }),
    })
    const result = await verifier.verify(
      { nullifier: 'n', credentialId: 11, signal: 's', payload: { protocol_version: '3.0' } },
      { action: REHYDRATE_REQUEST_ACTION, signal: 's' },
    )
    expect(result.valid).toBe(false)
  })
})

describe('nullifier store', () => {
  it('rejects replay via UNIQUE insert', async () => {
    const store = new MemoryNullifierStore()
    const verifier = createMockSelfieCheckVerifier()
    const proof = {
      nullifier: 'n1',
      credentialId: 11,
      signal: 's',
      payload: {},
    }
    const first = await evaluateRehydrateRequest(
      { proof, expectedSignal: 's', nullifierStore: store },
      verifier,
    )
    const second = await evaluateRehydrateRequest(
      { proof, expectedSignal: 's', nullifierStore: store },
      verifier,
    )
    expect(first).toEqual({ approved: true, nullifier: 'n1' })
    expect(second).toEqual({ approved: false, reason: 'nullifier-replay' })
  })
})
