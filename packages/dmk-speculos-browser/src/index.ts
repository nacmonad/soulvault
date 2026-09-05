import type {
  ConnectError,
  DeviceId,
  DisconnectHandler,
  DmkError,
  Transport,
  TransportArgs,
  TransportConnectedDevice,
  TransportDiscoveredDevice,
  TransportFactory,
  TransportIdentifier,
} from '@ledgerhq/device-management-kit';
import type { Either } from 'purify-ts';
import { EMPTY, type Observable, of } from 'rxjs';

export const SPECULOS_BROWSER_IDENTIFIER =
  'SOULVAULT_SPECULOS_BROWSER_TRANSPORT' as TransportIdentifier;

export type SpeculosBrowserOptions = {
  apduUrl: string;
  apiUrl?: string;
  fetch?: typeof globalThis.fetch;
};

export type EmulatedLedgerMetadata = {
  emulated: true;
  transport: 'speculos-http';
};

export type SpeculosBrowserTransportRegistration = {
  identifier: TransportIdentifier;
  factory: TransportFactory;
  metadata: EmulatedLedgerMetadata;
};

class ContractTracerTransport implements Transport {
  constructor(readonly options: Required<Pick<SpeculosBrowserOptions, 'apduUrl' | 'fetch'>>) {}

  getIdentifier(): TransportIdentifier {
    return SPECULOS_BROWSER_IDENTIFIER;
  }

  isSupported(): boolean {
    return true;
  }

  startDiscovering(): Observable<TransportDiscoveredDevice> {
    return EMPTY;
  }

  stopDiscovering(): void {}

  listenToAvailableDevices(): Observable<TransportDiscoveredDevice[]> {
    return of([]);
  }

  async connect(_params: {
    deviceId: DeviceId;
    onDisconnect: DisconnectHandler;
  }): Promise<Either<ConnectError, TransportConnectedDevice>> {
    throw new Error('Speculos browser connection is not implemented');
  }

  async disconnect(_params: {
    connectedDevice: TransportConnectedDevice;
  }): Promise<Either<DmkError, void>> {
    throw new Error('Speculos browser disconnection is not implemented');
  }
}

export function createSpeculosTransport(
  options: SpeculosBrowserOptions,
): SpeculosBrowserTransportRegistration {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const factory: TransportFactory = (_args: TransportArgs) =>
    new ContractTracerTransport({
      apduUrl: options.apduUrl,
      fetch: fetchImplementation,
    });

  return {
    identifier: SPECULOS_BROWSER_IDENTIFIER,
    factory,
    metadata: {
      emulated: true,
      transport: 'speculos-http',
    },
  };
}
