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

  await reviewAndApproveAddress(speculos.controller);
  await expect(page.getByTestId('wallet-status')).toHaveText('connected');
  const address = await page.getByTestId('wallet-address').innerText();
  expect(address).toMatch(/^0x[0-9a-f]{40}$/i);
  if (process.env.SOULVAULT_SPECULOS_EXPECTED_ADDRESS) {
    expect(address.toLowerCase()).toBe(process.env.SOULVAULT_SPECULOS_EXPECTED_ADDRESS.toLowerCase());
  }
  await page.waitForTimeout(2_000);

  await testInfo.attach('speculos-screen-transcript', {
    body: Buffer.from(JSON.stringify(speculos.controller.getTranscript(), null, 2)),
    contentType: 'application/json',
  });
  await testInfo.attach('derived-address', {
    body: Buffer.from(`${address}\n`),
    contentType: 'text/plain',
  });
});

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
