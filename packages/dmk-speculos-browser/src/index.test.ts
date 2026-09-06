import {
  DeviceActionStatus,
  DeviceManagementKitBuilder,
  type Transport,
  type TransportArgs,
  type TransportFactory,
} from '@ledgerhq/device-management-kit';
import { SignerEthBuilder } from '@ledgerhq/device-signer-kit-ethereum';
import { firstValueFrom } from 'rxjs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
  SPECULOS_BROWSER_IDENTIFIER,
  SpeculosBrowserTransportError,
  createSpeculosTransport,
} from './index.js';

describe('createSpeculosTransport', () => {
  it('returns an explicitly emulated, DMK-compatible transport factory', () => {
    const transport = createSpeculosTransport({
      apduUrl: 'http://127.0.0.1:5000/apdu',
      fetch: vi.fn<typeof fetch>(),
    });

    expect(transport.identifier).toBe(SPECULOS_BROWSER_IDENTIFIER);
    expect(transport.metadata).toEqual({
      emulated: true,
      transport: 'speculos-http',
    });
    expectTypeOf(transport.factory).toEqualTypeOf<TransportFactory>();
  });

  it('implements every method in the DMK 1.8 transport contract', () => {
    const { factory } = createSpeculosTransport({
      apduUrl: 'http://127.0.0.1:5000/apdu',
      fetch: vi.fn<typeof fetch>(),
    });
    const instance: Transport = factory({} as TransportArgs);

    expect(instance.getIdentifier()).toBe(SPECULOS_BROWSER_IDENTIFIER);
    expect(instance.isSupported()).toBe(true);
    expect(instance.startDiscovering).toBeTypeOf('function');
    expect(instance.stopDiscovering).toBeTypeOf('function');
    expect(instance.listenToAvailableDevices).toBeTypeOf('function');
    expect(instance.connect).toBeTypeOf('function');
    expect(instance.disconnect).toBeTypeOf('function');
  });

  it('discovers, connects, and exchanges APDUs using the browser fetch boundary', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: 'deadbeef9000' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { factory } = createSpeculosTransport({
      apduUrl: 'http://127.0.0.1:5000/apdu',
      fetch: fetchMock,
    });
    const transport = factory({} as TransportArgs);
    const discovered = await firstValueFrom(transport.startDiscovering());
    const connected = await transport.connect({ deviceId: discovered.id, onDisconnect: vi.fn() });
    const device = connected.unsafeCoerce();
    const response = await device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5000/apdu',
      expect.objectContaining({ body: JSON.stringify({ data: 'e0020000' }) }),
    );
    expect(response.unsafeCoerce().data).toEqual(Uint8Array.from([0xde, 0xad, 0xbe, 0xef]));
    expect(response.unsafeCoerce().statusCode).toEqual(Uint8Array.from([0x90, 0x00]));
  });

  it('drives an Ethereum address action through DMK', async () => {
    const publicKey =
      '04e3785ca6a5aa748c625e3dddd6d97b59b26fd8152fb52eb29d24404f010be4f725c3725e78bed953f074778d717974de21f3470b735736eb3d56747ab6d073a7';
    const address = 'F7C69BedB292Dd3fC2cA4103989B5BD705164c43';
    const responseData = `41${publicKey}28${textToHex(address)}9000`;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as { data: string };
      const data = request.data === 'b001000000'
        ? '0108457468657265756d06312e32322e339000'
        : responseData;
      return new Response(JSON.stringify({ data }), { status: 200 });
    });
    const registration = createSpeculosTransport({
      apduUrl: 'http://127.0.0.1:5000/apdu',
      fetch: fetchMock,
    });
    const dmk = new DeviceManagementKitBuilder().addTransport(registration.factory).build();

    const device = await firstValueFrom(
      dmk.startDiscovering({ transport: registration.identifier }),
    );
    const sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    const signer = new SignerEthBuilder({ dmk, sessionId }).build();
    const result = await completedOutput(
      signer.getAddress("44'/60'/0'/0/0", {
        checkOnDevice: false,
        skipOpenApp: true,
      }),
    );

    expect(result).toEqual({
      address: `0x${address}`,
      chainCode: undefined,
      publicKey,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).data)).toEqual([
      'b001000000',
      'e002000015058000002c8000003c800000000000000000000000',
    ]);
    await dmk.disconnect({ sessionId });
    dmk.close();
  });

  it('maps malformed bridge replies to a stable error and disconnects once', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ data: 'not-hex' }), { status: 200 }),
    );
    const onDisconnect = vi.fn();
    const { factory } = createSpeculosTransport({
      apduUrl: 'http://127.0.0.1:5000/apdu',
      fetch: fetchMock,
    });
    const transport = factory({} as TransportArgs);
    const discovered = await firstValueFrom(transport.startDiscovering());
    const connected = await transport.connect({ deviceId: discovered.id, onDisconnect });
    const device = connected.unsafeCoerce();

    const first = await device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));
    const second = await device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));

    expect(first.extract()).toBeInstanceOf(SpeculosBrowserTransportError);
    expect(first.extract()).toMatchObject({
      _tag: 'SpeculosBrowserTransportError',
      errorCode: 'INVALID_HEX',
    });
    expect(second.isLeft()).toBe(true);
    expect(onDisconnect).toHaveBeenCalledOnce();
    expect(onDisconnect).toHaveBeenCalledWith(discovered.id);
  });

  it('rejects concurrent APDU actions without disrupting the active request', async () => {
    let releaseRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      () => new Promise<Response>((resolve) => {
        releaseRequest = resolve;
      }),
    );
    const { transport, device, onDisconnect } = await connectedTransport(fetchMock);

    const first = device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));
    const second = await device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));

    expect(second.extract()).toMatchObject({ errorCode: 'CONCURRENT_ACTION' });
    releaseRequest?.(new Response(JSON.stringify({ data: '9000' }), { status: 200 }));
    expect((await first).isRight()).toBe(true);
    expect(onDisconnect).not.toHaveBeenCalled();
    await transport.disconnect({ connectedDevice: device });
  });

  it('aborts an in-flight APDU request on disconnect and can reconnect', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      }),
    );
    const { transport, device, discovered, onDisconnect } = await connectedTransport(fetchMock);

    const pending = device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));
    await transport.disconnect({ connectedDevice: device });

    expect((await pending).extract()).toMatchObject({ errorCode: 'ABORTED' });
    expect(onDisconnect).not.toHaveBeenCalled();
    const reconnected = await transport.connect({ deviceId: discovered.id, onDisconnect: vi.fn() });
    expect(reconnected.isRight()).toBe(true);
  });

  it('times out an APDU request and reports one disconnect', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        }),
      );
      const { factory } = createSpeculosTransport({
        apduUrl: 'http://127.0.0.1:5000/apdu',
        fetch: fetchMock,
        requestTimeoutMs: 50,
      });
      const transport = factory({} as TransportArgs);
      const discovered = await firstValueFrom(transport.startDiscovering());
      const onDisconnect = vi.fn();
      const connected = await transport.connect({ deviceId: discovered.id, onDisconnect });
      const request = connected.unsafeCoerce().sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));

      await vi.advanceTimersByTimeAsync(50);

      expect((await request).extract()).toMatchObject({ errorCode: 'TIMEOUT' });
      expect(onDisconnect).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the cause when the APDU bridge connection is lost', async () => {
    const cause = new TypeError('fetch failed');
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(cause);
    const { device, onDisconnect } = await connectedTransport(fetchMock);

    const result = await device.sendApdu(Uint8Array.from([0xe0, 0x02, 0, 0]));

    expect(result.extract()).toMatchObject({
      errorCode: 'CONNECTION_LOST',
      originalError: cause,
    });
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});

async function connectedTransport(fetchMock: typeof fetch) {
  const { factory } = createSpeculosTransport({
    apduUrl: 'http://127.0.0.1:5000/apdu',
    fetch: fetchMock,
  });
  const transport = factory({} as TransportArgs);
  const discovered = await firstValueFrom(transport.startDiscovering());
  const onDisconnect = vi.fn();
  const connected = await transport.connect({ deviceId: discovered.id, onDisconnect });
  return { transport, discovered, device: connected.unsafeCoerce(), onDisconnect };
}

function textToHex(value: string): string {
  return Array.from(value, (character) => character.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

function completedOutput<T>(action: {
  observable: {
    subscribe(observer: {
      next(state: { status: DeviceActionStatus; output?: T; error?: unknown }): void;
      error(cause: unknown): void;
    }): { unsubscribe(): void };
  };
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
      error: reject,
    });
  });
}
