import { isSpeculosReachable, startSpeculos } from './speculos-lifecycle.js';

let stopSpeculos: (() => Promise<void>) | undefined;

export default async function globalSetup() {
  const existingUrl = process.env.SOULVAULT_SPECULOS_API_URL;
  if (existingUrl && await isSpeculosReachable(existingUrl)) return;

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

  return async () => {
    await stopSpeculos?.();
  };
}
