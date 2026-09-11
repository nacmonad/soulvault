import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * Speculos/Playwright e2e against the built dashboard.
 *
 * Default suite (ticket 023): `proof-of-selfie.speculos.e2e.ts` — publish
 * flag, fixture proof on request, Grants fail-closed, unwrap ungated.
 * Detector strings are not the pass condition.
 *
 * Opt-in Alice/Charlie/Mallory Ledger scenario (ticket 006):
 *   SOULVAULT_E2E_SUITE=documents pnpm --filter soulvault-web test:e2e:ledger:documents
 *
 * Required outside env:
 *   - a local Anvil/ens-app-v3 node at SOULVAULT_E2E_RPC_URL (default
 *     http://127.0.0.1:8545, chain id 1337) — the suite does not start one;
 *   - Speculos via SOULVAULT_SPECULOS_API_URL (existing instance) or the
 *     managed container: SOULVAULT_SPECULOS_APP_ELF (absolute path to a
 *     lawfully obtained Ledger Ethereum app ELF) + SOULVAULT_SPECULOS_IMAGE
 *     (digest-pinned). Defaults point at the repo's provisioned ELF and the
 *     pinned image used when this suite was authored.
 *
 * Run: pnpm --filter soulvault-web test:e2e:ledger
 */

const repoRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const defaultElf = path.join(repoRoot, "packages/node/test/speculos/apps/nanosp-ethereum.elf");
const webPort = 3100;

if (!process.env.SOULVAULT_SPECULOS_APP_ELF && existsSync(defaultElf)) {
  process.env.SOULVAULT_SPECULOS_APP_ELF = defaultElf;
}
process.env.SOULVAULT_SPECULOS_IMAGE ||= "ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11";

const rpcUrl = process.env.SOULVAULT_E2E_RPC_URL || "http://127.0.0.1:8545";
const chainId = process.env.SOULVAULT_E2E_CHAIN_ID || "1337";
const worldAppId = process.env.NEXT_PUBLIC_WORLD_APP_ID || "app_99dc82c37d167284ef081f8cdbe20222";
const worldRpId = process.env.NEXT_PUBLIC_WORLD_RP_ID || "rp_301afe7f18a97891";
const worldRpUrl = process.env.NEXT_PUBLIC_WORLD_RP_URL || "http://127.0.0.1:8787";
const suite = process.env.SOULVAULT_E2E_SUITE === "documents" ? "documents-flow.speculos.e2e.ts" : "proof-of-selfie.speculos.e2e.ts";
// A dedicated e2e build flag compiles the test-only Speculos transport gate in;
// regular production builds dead-code-eliminate it (never shipped).
const buildEnv = [
  "SOULVAULT_WEB_E2E=1",
  `NEXT_PUBLIC_SOULVAULT_RPC_URL=${rpcUrl}`,
  `NEXT_PUBLIC_SOULVAULT_CHAIN_ID=${chainId}`,
  `NEXT_PUBLIC_WORLD_APP_ID=${worldAppId}`,
  `NEXT_PUBLIC_WORLD_RP_ID=${worldRpId}`,
  `NEXT_PUBLIC_WORLD_RP_URL=${worldRpUrl}`,
  "NEXT_PUBLIC_WORLD_ENVIRONMENT=staging",
].join(" ");

export default defineConfig({
  testDir: ".",
  testMatch: suite,
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  outputDir: "./.artifacts/results",
  use: {
    baseURL: "http://127.0.0.1:3100",
    screenshot: "only-on-failure",
    trace: "on",
    video: "on",
  },
  webServer: {
    command: `${buildEnv} pnpm --dir .. exec next build --webpack && ${buildEnv} pnpm --dir .. exec next start -p 3100`,
    url: "http://127.0.0.1:3100/dashboard",
    reuseExistingServer: false,
    timeout: 900_000,
  },
  reporter: [["list"], ["html", { outputFolder: "./.artifacts/report", open: "never" }]],
});
