import { describe, expect, it } from 'vitest'
import { WorldIdentityConfig } from './world-identity.js'
import { startWorldRpServer } from './world-rp-server.js'

const signingKeyHex = 'a'.repeat(64)
const config = WorldIdentityConfig.parse({
  appId: 'app_test',
  rpId: 'rp_test',
  signingKeyHex,
  environment: 'staging',
})

describe('world RP server', () => {
  it('returns 503 for signatures when the signing key is unset', async () => {
    const { port, close } = await startWorldRpServer({ config: null, port: 0, mock: true })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/rp-signature`)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'rp-signing-unconfigured' })
    } finally {
      await close()
    }
  })

  it('signs without leaking the key', async () => {
    const { port, close } = await startWorldRpServer({ config, port: 0, mock: true })
    try {
      const res = await fetch(`http://127.0.0.1:${port}/rp-signature`)
      expect(res.status).toBe(200)
      const body = await res.text()
      expect(body).not.toContain(signingKeyHex)
      expect(body).not.toMatch(/signingKey/i)
      const parsed = JSON.parse(body) as { sig: string; nonce: string; rp_id: string }
      expect(parsed.rp_id).toBe('rp_test')
      expect(parsed.sig).toBeTruthy()
      expect(parsed.nonce).toBeTruthy()
    } finally {
      await close()
    }
  })

  it('verifies an IDKit-shaped selfie with the mock and rejects replay', async () => {
    const { port, close } = await startWorldRpServer({ config, port: 0, mock: true })
    try {
      const idkitResponse = {
        protocol_version: '3.0',
        responses: [{ identifier: 'selfie', nullifier: 'n-replay' }],
      }
      const first = await fetch(`http://127.0.0.1:${port}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSignal: 'sig', idkitResponse }),
      })
      expect(first.status).toBe(200)
      expect(await first.json()).toEqual({ approved: true, nullifier: 'n-replay' })
      const second = await fetch(`http://127.0.0.1:${port}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedSignal: 'sig', idkitResponse }),
      })
      expect(second.status).toBe(400)
      expect(await second.json()).toEqual({ approved: false, reason: 'nullifier-replay' })
    } finally {
      await close()
    }
  })
})
