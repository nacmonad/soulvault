import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { URL } from 'node:url'

import {
  MemoryNullifierStore,
  REHYDRATE_REQUEST_ACTION,
  createMockSelfieCheckVerifier,
  createPortalSelfieCheckVerifier,
  evaluateRehydrateRequest,
  generateRpSignature,
  type NullifierStore,
  type PortalVerifyFetch,
  type WorldIdentityConfig,
} from './world-identity.js'

const DEFAULT_ORIGINS = [
  'https://soulvault.test',
  'http://127.0.0.1:46183',
  'http://localhost:46183',
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:3100',
  'http://localhost:3100',
]

export type WorldRpServerOptions = {
  config: WorldIdentityConfig | null
  /** Use the mock verifier (local tests). Default: portal when config is set. */
  mock?: boolean
  store?: NullifierStore
  fetchImpl?: PortalVerifyFetch
  allowedOrigins?: string[]
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function applyCors(req: IncomingMessage, res: ServerResponse, allowed: Set<string>) {
  const origin = req.headers.origin
  if (origin && allowed.has(origin)) {
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'Origin')
  }
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
}

/**
 * Tiny RP worker for IDKit. Pages export cannot host Next API routes, so
 * Rehydrate talks to this process over NEXT_PUBLIC_WORLD_RP_URL.
 * Never logs request bodies or the signing key.
 */
export function createWorldRpHandler(opts: WorldRpServerOptions) {
  const store = opts.store ?? new MemoryNullifierStore()
  const allowed = new Set([...(opts.allowedOrigins ?? DEFAULT_ORIGINS)])
  const mock = Boolean(opts.mock) || !opts.config
  const verifier = mock
    ? createMockSelfieCheckVerifier()
    : createPortalSelfieCheckVerifier({
        rpId: opts.config!.rpId,
        fetchImpl: opts.fetchImpl,
      })

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applyCors(req, res, allowed)
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? '/', `http://${host}`)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (method === 'GET' && path === '/health') {
      json(res, 200, {
        ok: true,
        configured: Boolean(opts.config),
        mock,
        action: REHYDRATE_REQUEST_ACTION,
        appId: opts.config?.appId ?? null,
        rpId: opts.config?.rpId ?? null,
        environment: opts.config?.environment ?? null,
      })
      return
    }

    if ((method === 'GET' || method === 'POST') && path === '/rp-signature') {
      if (!opts.config) {
        json(res, 503, { error: 'rp-signing-unconfigured' })
        return
      }
      let action = url.searchParams.get('action') ?? REHYDRATE_REQUEST_ACTION
      if (method === 'POST') {
        try {
          const parsed = JSON.parse((await readBody(req)) || '{}') as { action?: unknown }
          if (typeof parsed.action === 'string' && parsed.action.length > 0) action = parsed.action
        } catch {
          json(res, 400, { error: 'malformed-json' })
          return
        }
      }
      const sig = await generateRpSignature(opts.config, action)
      json(res, 200, {
        rp_id: opts.config.rpId,
        action,
        environment: opts.config.environment,
        sig: sig.sig,
        nonce: sig.nonce,
        created_at: sig.createdAt,
        expires_at: sig.expiresAt,
      })
      return
    }

    if (method === 'POST' && path === '/verify') {
      let body: { expectedSignal?: unknown; idkitResponse?: unknown; proof?: unknown }
      try {
        body = JSON.parse((await readBody(req)) || '{}') as typeof body
      } catch {
        json(res, 400, { error: 'malformed-json' })
        return
      }
      const expectedSignal = typeof body.expectedSignal === 'string' ? body.expectedSignal : ''
      if (!expectedSignal) {
        json(res, 400, { error: 'missing-signal' })
        return
      }
      const proof = body.proof ?? body.idkitResponse
      const result = await evaluateRehydrateRequest(
        { proof, expectedSignal, nullifierStore: store },
        verifier,
      )
      json(res, result.approved ? 200 : 400, result)
      return
    }

    json(res, 404, { error: 'not-found' })
  }
}

export function startWorldRpServer(
  opts: WorldRpServerOptions & { port?: number; host?: string },
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const handle = createWorldRpHandler(opts)
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'internal' })
      else res.end()
    })
  })
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 8787
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : port
      resolve({
        server,
        port: bound,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()))
          }),
      })
    })
  })
}
