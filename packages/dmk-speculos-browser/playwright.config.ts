import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: '**/*.speculos.e2e.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  outputDir: './artifacts/playwright',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    screenshot: 'only-on-failure',
    trace: 'on',
    video: 'on',
  },
  webServer: {
    command: 'pnpm --dir ../../apps/web dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/ledger-speculos-proof',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
