import type { Transport, TransportArgs, TransportFactory } from '@ledgerhq/device-management-kit';
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
});
