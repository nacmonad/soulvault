import type { Transport, TransportArgs, TransportFactory } from '@ledgerhq/device-management-kit';
import { firstValueFrom } from 'rxjs';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { SPECULOS_BROWSER_IDENTIFIER, createSpeculosTransport } from './index.js';

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
});
