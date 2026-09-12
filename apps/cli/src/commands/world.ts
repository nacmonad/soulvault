import { Command } from 'commander'
import {
  REHYDRATE_REQUEST_ACTION,
  SelfieProof,
  SelfieCheckVerifier,
  createMockSelfieCheckVerifier,
  evaluateRehydrateRequest,
  generateRpSignature,
} from '@soulvault/node/world-identity'
import { startWorldRpServer } from '@soulvault/node/world-rp-server'
import { loadEnv, loadWorldIdentityConfig } from '@soulvault/node/config'

/**
 * World identity CLI surface (Selfie Check / World ID credential 11).
 *
 * PoC scope: the verifier is the mock implementation; the Developer Portal
 * verification call is a drop-in swap once the Selfie Check feature flag is
 * enabled for the app.
 */

export function registerWorldCommands(program: Command) {
  const world = program
    .command('world')
    .description('World ID / Selfie Check identity helpers (credential 11)')

  world
    .command('status')
    .description('Show World identity integration configuration state')
    .action(async () => {
      const env = loadEnv()
      const config = loadWorldIdentityConfig(env)
      const state = {
        configured: config !== null,
        appId: env.WORLD_APP_ID ?? null,
        rpId: env.WORLD_RP_ID ?? null,
        signingKeyConfigured: Boolean(env.WORLD_RP_SIGNING_KEY),
        environment: env.WORLD_ENVIRONMENT,
        action: REHYDRATE_REQUEST_ACTION,
        note:
          config === null
            ? 'Set WORLD_APP_ID, WORLD_RP_ID, and WORLD_RP_SIGNING_KEY in .env to enable the World identity layer.'
            : 'World identity layer configured; Selfie Check proof flows additionally require the app feature flag from World.',
      }
      console.log(JSON.stringify(state, null, 2))
    })

  world
    .command('rp-signature')
    .description('Generate a backend RP signature for a Selfie Check proof request')
    .option('--action <action>', 'Action scoping the proof', REHYDRATE_REQUEST_ACTION)
    .action(async (options) => {
      const env = loadEnv()
      const config = loadWorldIdentityConfig(env)
      if (!config) {
        console.error(
          'World identity not configured. Set WORLD_APP_ID, WORLD_RP_ID, and WORLD_RP_SIGNING_KEY in .env.',
        )
        process.exitCode = 1
        return
      }
      const sig = await generateRpSignature(config, options.action)
      console.log(
        JSON.stringify(
          {
            action: options.action,
            environment: config.environment,
            ...sig,
          },
          null,
          2,
        ),
      )
    })

  world
    .command('verify-proof')
    .description('Evaluate a rehydrate request against a Selfie Check proof (author-side gate)')
    .requiredOption('--proof <json>', 'Selfie Check proof payload as JSON')
    .requiredOption('--signal <value>', 'Expected signal (requester wallet address)')
    .option('--nullifiers <csv>', 'Already-consumed nullifiers for the action', '')
    .action(async (options) => {
      const verifier: SelfieCheckVerifier = createMockSelfieCheckVerifier()
      const consumed = new Set<string>(
        options.nullifiers
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean),
      )
      let proof: unknown
      try {
        proof = JSON.parse(options.proof)
      } catch {
        console.error('Invalid --proof JSON')
        process.exitCode = 1
        return
      }
      // Validate shape up front so malformed payloads fail the same way as the node path.
      const parsed = SelfieProof.safeParse(proof)
      const result = await evaluateRehydrateRequest(
        { proof, expectedSignal: options.signal, consumedNullifiers: consumed },
        verifier,
      )
      console.log(
        JSON.stringify(
          {
            ...result,
            action: REHYDRATE_REQUEST_ACTION,
            proofShapeValid: parsed.success,
          },
          null,
          2,
        ),
      )
      if (!result.approved) process.exitCode = 2
    })

  world
    .command('rp-server')
    .description(
      'Serve GET /rp-signature and POST /verify for the dashboard IDKit widget. Signing key stays on this process.',
    )
    .option('--port <port>', 'Listen port', '8787')
    .option('--host <host>', 'Listen host', '127.0.0.1')
    .option('--mock', 'Use the mock Selfie Check verifier (no Portal call)', false)
    .action(async (options) => {
      const env = loadEnv()
      const config = loadWorldIdentityConfig(env)
      const port = Number(options.port)
      const mock = Boolean(options.mock) || !config
      const { port: bound } = await startWorldRpServer({
        config,
        port,
        host: options.host,
        mock,
      })
      console.log(
        JSON.stringify({
          listening: `http://${options.host}:${bound}`,
          configured: Boolean(config),
          mock,
          action: REHYDRATE_REQUEST_ACTION,
        }),
      )
    })
}
