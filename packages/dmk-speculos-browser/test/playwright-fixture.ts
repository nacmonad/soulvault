import { test as base } from '@playwright/test';
import { createSpeculosController, type SpeculosController } from '../src/test.js';
import { startApduBridge } from './apdu-bridge.js';
import { isSpeculosReachable, startSpeculos } from './speculos-lifecycle.js';

export type SpeculosPlaywrightFixture = {
  apiUrl: string;
  apduUrl: string;
  controller: SpeculosController;
  emulated: true;
};

export const test = base.extend<{}, { speculos: SpeculosPlaywrightFixture }>({
  speculos: [async ({}, use) => {
    const existingUrl = process.env.SOULVAULT_SPECULOS_API_URL;
    let lifecycle: Awaited<ReturnType<typeof startSpeculos>> | undefined;
    let apiUrl: string;
    if (existingUrl && await isSpeculosReachable(existingUrl)) {
      apiUrl = existingUrl;
    } else {
      const appElfPath = requiredEnvironment('SOULVAULT_SPECULOS_APP_ELF');
      const image = requiredEnvironment('SOULVAULT_SPECULOS_IMAGE');
      if (!image.includes('@sha256:')) {
        throw new Error('SOULVAULT_SPECULOS_IMAGE must pin the official image by sha256 digest');
      }
      lifecycle = await startSpeculos({ appElfPath, image });
      apiUrl = lifecycle.apiUrl;
    }
    const bridge = await startApduBridge(apiUrl);
    try {
      await use({
        apiUrl,
        apduUrl: bridge.apduUrl,
        controller: createSpeculosController({ apiUrl, timeoutMs: 120_000 }),
        emulated: true,
      });
    } finally {
      await bridge.stop();
      await lifecycle?.stop();
    }
  }, { scope: 'worker' }],
});

export { expect } from '@playwright/test';

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the Speculos Playwright fixture`);
  return value;
}
