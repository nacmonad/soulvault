import { isSpeculosReachable, startSpeculos } from './speculos-lifecycle.js';
import { createSpeculosController } from '../src/test.js';

let stopSpeculos: (() => Promise<void>) | undefined;

export default async function globalSetup() {
  const existingUrl = process.env.SOULVAULT_SPECULOS_API_URL;
  if (existingUrl && await isSpeculosReachable(existingUrl)) {
    await enableBlindSigning(existingUrl);
    return;
  }

  const appElfPath = process.env.SOULVAULT_SPECULOS_APP_ELF;
  if (!appElfPath) {
    throw new Error(
      'SOULVAULT_SPECULOS_APP_ELF must point to an externally supplied Ethereum app ELF',
    );
  }
  const image = process.env.SOULVAULT_SPECULOS_IMAGE;
  if (!image || !image.includes('@sha256:')) {
    throw new Error('SOULVAULT_SPECULOS_IMAGE must pin the official image by sha256 digest');
  }
  const handle = await startSpeculos({ appElfPath, image });
  process.env.SOULVAULT_SPECULOS_API_URL = handle.apiUrl;
  stopSpeculos = handle.stop;
  await enableBlindSigning(handle.apiUrl);

  return async () => {
    await stopSpeculos?.();
  };
}

async function enableBlindSigning(apiUrl: string): Promise<void> {
  const controller = createSpeculosController({ apiUrl, timeoutMs: 15_000 });
  for (let step = 0; step < 16; step += 1) {
    const text = (await controller.pollScreen()).map((event) => event.text).join(' | ');
    if (/app settings/i.test(text)) {
      await controller.pressBoth();
      await delay();
      break;
    }
    await controller.pressRight();
    await delay();
  }
  for (let step = 0; step < 16; step += 1) {
    const text = (await controller.pollScreen()).map((event) => event.text).join(' | ');
    if (/blind signing/i.test(text)) {
      if (/not enabled|disabled/i.test(text)) {
        await controller.pressBoth();
        await delay();
      }
      await controller.pressLeft();
      await delay();
      return;
    }
    await controller.pressRight();
    await delay();
  }
  throw new Error('Could not locate the Ethereum app blind-signing setting');
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}
