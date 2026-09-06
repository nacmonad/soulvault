import { DeviceActionStatus, DeviceManagementKitBuilder } from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { createSpeculosTransport } from './index.js';
import { createSpeculosController } from './test.js';

const environment = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;
const apiUrl = environment?.SOULVAULT_SPECULOS_API_URL;
const run = apiUrl ? describe : describe.skip;

run('real DMK signing against Speculos', () => {
  it('signs EIP-712 typed data after explicit on-device review', async () => {
    const registration = createSpeculosTransport({
      apduUrl: `${apiUrl}/apdu`,
      requestTimeoutMs: 120_000,
    });
    const controller = createSpeculosController({ apiUrl: apiUrl!, timeoutMs: 120_000 });
    const dmk = new DeviceManagementKitBuilder().addTransport(registration.factory).build();

    try {
      const device = await firstValueFrom(
        dmk.startDiscovering({ transport: registration.identifier }),
      );
      const sessionId = await dmk.connect({
        device,
        sessionRefresherOptions: { isRefresherDisabled: true },
      });
      const signer = new SignerEthBuilder({ dmk, sessionId }).build();
      const action = signer.signTypedData("44'/60'/0'/0/0", {
        domain: {
          name: 'SoulVault',
          version: '1',
          chainId: 1,
          verifyingContract: '0x000000000000000000000000000000000000dEaD',
        },
        types: {
          Rehydrate: [
            { name: 'documentId', type: 'bytes32' },
            { name: 'version', type: 'uint256' },
          ],
        },
        primaryType: 'Rehydrate',
        message: {
          documentId: `0x${'12'.repeat(32)}`,
          version: 1,
        },
      }, { skipOpenApp: true });
      const resultPromise = completedOutput<{ r: string; s: string; v: number }>(action);
      void resultPromise.catch(() => undefined);

      await reviewAndSign(controller);
      const { output, statuses } = await resultPromise;

      expect(output.r).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(output.s).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(output.v).toBeGreaterThanOrEqual(0);
      expect(statuses.at(-1)).toBe(DeviceActionStatus.Completed);
      expect(controller.getTranscript().some((entry) => entry.button === 'both')).toBe(true);
      await dmk.disconnect({ sessionId });
    } finally {
      dmk.close();
    }
  });

  it('signs an EIP-1559 transaction after explicit on-device review', async () => {
    const registration = createSpeculosTransport({
      apduUrl: `${apiUrl}/apdu`,
      requestTimeoutMs: 120_000,
    });
    const controller = createSpeculosController({ apiUrl: apiUrl!, timeoutMs: 120_000 });
    const dmk = new DeviceManagementKitBuilder().addTransport(registration.factory).build();

    try {
      const device = await firstValueFrom(
        dmk.startDiscovering({ transport: registration.identifier }),
      );
      const sessionId = await dmk.connect({
        device,
        sessionRefresherOptions: { isRefresherDisabled: true },
      });
      const signer = new SignerEthBuilder({ dmk, sessionId }).build();
      const unsignedTransaction = hexToBytes(
        '02e70180843b9aca00847735940082520894000000000000000000000000000000000000dead0180c0',
      );
      const action = signer.signTransaction("44'/60'/0'/0/0", unsignedTransaction, {
        skipOpenApp: true,
      });
      const resultPromise = completedOutput<{ r: string; s: string; v: number }>(action);
      void resultPromise.catch(() => undefined);

      await reviewAndSign(controller);
      const { output, statuses } = await resultPromise;

      expect(output.r).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(output.s).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(output.v).toBeGreaterThanOrEqual(0);
      expect(statuses.at(-1)).toBe(DeviceActionStatus.Completed);
      await dmk.disconnect({ sessionId });
    } finally {
      dmk.close();
    }
  });
});

async function reviewAndSign(controller: ReturnType<typeof createSpeculosController>) {
  for (let step = 0; step < 80; step += 1) {
    const screen = await controller.pollScreen();
    const text = screen.map((event) => event.text).join(' | ');
    if (/\bapprove\b|\bsign (?:message|transaction)\b|\bhold to sign\b|accept and send/i.test(text)) {
      await controller.pressBoth();
      return;
    }
    if (/blind signing ahead|accept risk/i.test(text)) {
      await controller.pressBoth();
    } else {
      await controller.pressRight();
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const screens = controller.getTranscript()
    .filter((entry) => entry.kind === 'screen')
    .map((entry) => entry.screen?.map((event) => event.text).join(' | '));
  throw new Error(`Speculos typed-data review did not reach approval: ${screens.join(' -> ')}`);
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

function completedOutput<T>(action: {
  observable: {
    subscribe(observer: {
      next(state: { status: DeviceActionStatus; output?: T; error?: unknown }): void;
      error(cause: unknown): void;
    }): { unsubscribe(): void };
  };
}): Promise<{ output: T; statuses: DeviceActionStatus[] }> {
  return new Promise((resolve, reject) => {
    const statuses: DeviceActionStatus[] = [];
    const subscription = action.observable.subscribe({
      next(state) {
        statuses.push(state.status);
        if (state.status === DeviceActionStatus.Completed) {
          subscription.unsubscribe();
          resolve({ output: state.output as T, statuses });
        } else if (state.status === DeviceActionStatus.Error) {
          subscription.unsubscribe();
          reject(state.error);
        }
      },
      error: reject,
    });
  });
}
