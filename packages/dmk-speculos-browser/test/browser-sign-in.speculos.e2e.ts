import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { test, expect } from './playwright-fixture.js';

test('signs into the React wallet context through DMK and Speculos', async ({
  page,
  speculos,
}, testInfo) => {
  await page.goto(`/ledger-speculos-proof?apduUrl=${encodeURIComponent(speculos.apduUrl)}&eventsUrl=${encodeURIComponent(speculos.eventsUrl)}`);
  await expect(page.getByTestId('evidence-label')).toContainText('Speculos emulation');
  await expect(page.getByRole('button', { name: 'Sign in with Ledger' })).toBeVisible();
  await page.waitForTimeout(1_500);
  await page.getByRole('button', { name: 'Sign in with Ledger' }).click();
  await expect(page.getByTestId('wallet-status')).toHaveText('connecting');
  await page.waitForTimeout(1_000);

  await reviewAndRejectAddress(speculos.controller);
  await expect(page.getByTestId('wallet-status')).toHaveText('error');
  await expect(page.locator('p[role="alert"]')).toHaveText('Action cancelled on device.');
  await expect(page.getByTestId('wallet-address')).toHaveCount(0);
  await page.waitForTimeout(1_000);

  await page.getByRole('button', { name: 'Sign in with Ledger' }).click();
  await expect(page.getByTestId('wallet-status')).toHaveText('connecting');
  await reviewAndApproveAddress(speculos.controller);
  await expect(page.getByTestId('wallet-status')).toHaveText('connected');
  const address = await page.getByTestId('wallet-address').innerText();
  expect(address).toMatch(/^0x[0-9a-f]{40}$/i);
  if (process.env.SOULVAULT_SPECULOS_EXPECTED_ADDRESS) {
    expect(address.toLowerCase()).toBe(process.env.SOULVAULT_SPECULOS_EXPECTED_ADDRESS.toLowerCase());
  }
  await page.waitForTimeout(2_000);

  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByTestId('wallet-status')).toHaveText('idle');
  await expect(page.getByTestId('wallet-address')).toHaveCount(0);
  await page.waitForTimeout(1_000);

  await page.getByRole('button', { name: 'Sign in with Ledger' }).click();
  await expect(page.getByTestId('wallet-status')).toHaveText('connecting');
  await reviewAndApproveAddress(speculos.controller);
  await expect(page.getByTestId('wallet-status')).toHaveText('connected');
  await expect(page.getByTestId('wallet-address')).toHaveText(address);
  await page.waitForTimeout(2_000);

  const transcriptPath = testInfo.outputPath('speculos-screen-transcript.json');
  const addressPath = testInfo.outputPath('derived-address.txt');
  const metadataPath = testInfo.outputPath('proof-metadata.json');
  await writeFile(transcriptPath, `${JSON.stringify(speculos.controller.getTranscript(), null, 2)}\n`);
  await writeFile(addressPath, `${address}\n`);
  await writeFile(metadataPath, `${JSON.stringify(await proofMetadata(address), null, 2)}\n`);
  await testInfo.attach('speculos-screen-transcript', { path: transcriptPath });
  await testInfo.attach('derived-address', { path: addressPath });
  await testInfo.attach('proof-metadata', { path: metadataPath });
});

async function proofMetadata(address: string) {
  const elfPath = process.env.SOULVAULT_SPECULOS_APP_ELF;
  return {
    address,
    node: process.version,
    packages: {
      '@ledgerhq/device-management-kit': packageVersion('@ledgerhq/device-management-kit'),
      '@ledgerhq/device-signer-kit-ethereum': packageVersion('@ledgerhq/device-signer-kit-ethereum'),
      '@playwright/test': packageVersion('@playwright/test'),
    },
    speculosImage: process.env.SOULVAULT_SPECULOS_IMAGE,
    appElfSha256: elfPath
      ? createHash('sha256').update(await readFile(elfPath)).digest('hex')
      : undefined,
  };
}

function packageVersion(name: string): string {
  const require = createRequire(import.meta.url);
  let current = dirname(require.resolve(name));
  while (current !== dirname(current)) {
    try {
      return (JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as { version: string }).version;
    } catch {
      current = dirname(current);
    }
  }
  throw new Error(`Could not resolve package version for ${name}`);
}

async function reviewAndRejectAddress(controller: {
  pollScreen(): Promise<ReadonlyArray<{ text: string }>>;
  waitForScreen(matcher: RegExp): Promise<ReadonlyArray<{ text: string }>>;
  pressRight(): Promise<void>;
  pressBoth(): Promise<void>;
}) {
  await controller.waitForScreen(/\bAddress\b/i);
  for (let step = 0; step < 24; step += 1) {
    const screen = await controller.pollScreen();
    const text = screen.map((event) => event.text).join(' | ');
    if (/\bcancel\b|\breject\b/i.test(text)) {
      await controller.pressBoth();
      return;
    }
    await controller.pressRight();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Speculos address review did not reach its rejection screen');
}

async function reviewAndApproveAddress(controller: {
  pollScreen(): Promise<ReadonlyArray<{ text: string }>>;
  waitForScreen(matcher: RegExp): Promise<ReadonlyArray<{ text: string }>>;
  pressRight(): Promise<void>;
  pressBoth(): Promise<void>;
}) {
  // Do not navigate the app home while React/DMK is still scheduling the APDU.
  await controller.waitForScreen(/\bAddress\b/i);
  for (let step = 0; step < 24; step += 1) {
    const screen = await controller.pollScreen();
    const text = screen.map((event) => event.text).join(' | ');
    if (/\bapprove\b|\bconfirm(?: address)?\b/i.test(text)) {
      await controller.pressBoth();
      return;
    }
    await controller.pressRight();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Speculos address review did not reach its confirmation screen');
}
