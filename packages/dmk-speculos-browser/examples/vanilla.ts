import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  type DeviceSessionId,
} from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { firstValueFrom } from 'rxjs';
import { createSpeculosTransport } from '../src/index.js';

const ETHEREUM_PATH = "44'/60'/0'/0/0";

/**
 * Framework-neutral browser example. The caller/test controller must approve
 * the address review explicitly on Speculos while this promise is pending.
 */
export async function connectSpeculos(apduUrl: string): Promise<{
  address: string;
  disconnect(): Promise<void>;
}> {
  const registration = createSpeculosTransport({ apduUrl });
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(registration.factory)
    .build();
  let sessionId: DeviceSessionId | undefined;

  try {
    const device = await firstValueFrom(
      dmk.startDiscovering({ transport: registration.identifier }),
    );
    await dmk.stopDiscovering();
    sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    const signer = new SignerEthBuilder({ dmk, sessionId }).build();
    const account = await completedOutput<{ address: string }>(
      signer.getAddress(ETHEREUM_PATH, {
        checkOnDevice: true,
        skipOpenApp: true,
      }),
    );

    return {
      address: account.address,
      async disconnect() {
        if (sessionId) await dmk.disconnect({ sessionId });
        sessionId = undefined;
        dmk.close();
      },
    };
  } catch (error) {
    if (sessionId) await dmk.disconnect({ sessionId }).catch(() => undefined);
    dmk.close();
    throw error;
  }
}

function completedOutput<T>(action: {
  observable: {
    subscribe(observer: {
      next(state: { status: DeviceActionStatus; output?: T; error?: unknown }): void;
      error(error: unknown): void;
    }): { unsubscribe(): void };
  };
  cancel(): void;
}): Promise<T> {
  return new Promise((resolve, reject) => {
    const subscription = action.observable.subscribe({
      next(state) {
        if (state.status === DeviceActionStatus.Completed) {
          subscription.unsubscribe();
          resolve(state.output as T);
        } else if (state.status === DeviceActionStatus.Error) {
          subscription.unsubscribe();
          reject(state.error);
        }
      },
      error,
    });

    function error(cause: unknown) {
      subscription.unsubscribe();
      reject(cause);
    }
  });
}
