import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
} from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { createSpeculosTransport } from './index.js';
import { createSpeculosController } from './test.js';

const environment = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env;
const apiUrl = environment?.SOULVAULT_SPECULOS_API_URL;
const expectedAddress = environment?.SOULVAULT_SPECULOS_EXPECTED_ADDRESS;
const run = apiUrl ? describe : describe.skip;

run('real DMK browser transport against Speculos', () => {
  it('observes the address action states and verifies the address on-device', async () => {
    const registration = createSpeculosTransport({ apduUrl: `${apiUrl}/apdu` });
    const controller = createSpeculosController({ apiUrl: apiUrl! });
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
      const action = signer.getAddress("44'/60'/0'/0/0", {
        checkOnDevice: true,
        skipOpenApp: true,
      });

      const resultPromise = completedOutput<{ address: string }>(action);
      await controller.approve(/approve|confirm|verify/i);
      const { output, statuses } = await resultPromise;

      expect(output.address).toMatch(/^0x[0-9a-f]{40}$/i);
      if (expectedAddress) expect(output.address.toLowerCase()).toBe(expectedAddress.toLowerCase());
      expect(statuses).toContain(DeviceActionStatus.Pending);
      expect(statuses.at(-1)).toBe(DeviceActionStatus.Completed);
      expect(controller.getTranscript().some((entry) => entry.button === 'both')).toBe(true);

      await dmk.disconnect({ sessionId });
    } finally {
      dmk.close();
    }
  });
});

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
