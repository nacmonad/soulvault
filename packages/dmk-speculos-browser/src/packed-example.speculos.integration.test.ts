import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

const apiUrl = process.env.SOULVAULT_SPECULOS_API_URL;
const expectedAddress = process.env.SOULVAULT_SPECULOS_EXPECTED_ADDRESS;
const suite = apiUrl ? describe : describe.skip;
const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

suite('packed framework-neutral consumer', () => {
  it('installs the tarball outside the workspace and derives the expected address', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dmk-speculos-consumer-'));
    temporaryDirectories.push(directory);
    execFileSync('pnpm', ['pack', '--pack-destination', directory], {
      cwd: new URL('..', import.meta.url),
      stdio: 'pipe',
    });
    const tarball = join(directory, 'soulvault-dmk-speculos-browser-0.0.0.tgz');
    expect(readFileSync(tarball).length).toBeGreaterThan(0);
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@ledgerhq/device-management-kit': '1.8.0',
        '@ledgerhq/device-signer-kit-ethereum': '1.16.0',
        '@soulvault/dmk-speculos-browser': `file:${tarball}`,
        rxjs: '^7.8.2',
        tsx: '^4.20.6',
      },
    }, null, 2));
    writeFileSync(join(directory, 'index.ts'), consumerSource);
    execFileSync('pnpm', ['install', '--ignore-scripts'], {
      cwd: directory,
      stdio: 'pipe',
    });
    const address = execFileSync('pnpm', ['exec', 'tsx', 'index.ts', apiUrl!], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    expect(address).toMatch(/^0x[0-9a-f]{40}$/i);
    if (expectedAddress) expect(address.toLowerCase()).toBe(expectedAddress.toLowerCase());
  }, 60_000);
});

const consumerSource = `
import { DeviceActionStatus, DeviceManagementKitBuilder } from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { createSpeculosTransport } from '@soulvault/dmk-speculos-browser';
import { createSpeculosController } from '@soulvault/dmk-speculos-browser/test';
import { firstValueFrom } from 'rxjs';

const apiUrl = process.argv[2];
const registration = createSpeculosTransport({ apduUrl: apiUrl + '/apdu' });
const controller = createSpeculosController({ apiUrl, timeoutMs: 30_000 });
const dmk = new DeviceManagementKitBuilder().addTransport(registration.factory).build();
const device = await firstValueFrom(dmk.startDiscovering({ transport: registration.identifier }));
const sessionId = await dmk.connect({ device, sessionRefresherOptions: { isRefresherDisabled: true } });
const signer = new SignerEthBuilder({ dmk, sessionId }).build();
const action = signer.getAddress("44'/60'/0'/0/0", { checkOnDevice: true, skipOpenApp: true });
const result = completed(action);
await reviewAndApprove();
const account = await result;
console.log(account.address);
await dmk.disconnect({ sessionId });
dmk.close();

async function reviewAndApprove() {
  await controller.waitForScreen(/\\bAddress\\b/i);
  for (let step = 0; step < 24; step += 1) {
    const text = (await controller.pollScreen()).map((event) => event.text).join(' | ');
    if (/\\bapprove\\b|\\bconfirm(?: address)?\\b/i.test(text)) {
      await controller.pressBoth();
      return;
    }
    await controller.pressRight();
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Address review did not reach approval');
}

function completed(action) {
  return new Promise((resolve, reject) => {
    const subscription = action.observable.subscribe({
      next(state) {
        if (state.status === DeviceActionStatus.Completed) { subscription.unsubscribe(); resolve(state.output); }
        if (state.status === DeviceActionStatus.Error) { subscription.unsubscribe(); reject(state.error); }
      },
      error: reject,
    });
  });
}
`;
