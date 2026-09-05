import {
  ApduResponse,
  DeviceModelId,
  OpeningConnectionError,
  TransportConnectedDevice,
  TransportDeviceModel,
  type ApduResponse as ApduResponseType,
  ConnectError,
  DeviceId,
  DisconnectHandler,
  DmkError,
  Transport,
  TransportArgs,
  TransportDiscoveredDevice,
  TransportFactory,
  TransportIdentifier,
} from '@ledgerhq/device-management-kit';
import { Left, Right, type Either } from 'purify-ts';
import { type Observable, of } from 'rxjs';

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

export type SpeculosBrowserTransportErrorCode =
  | 'HTTP_FAILURE'
  | 'MALFORMED_RESPONSE'
  | 'INVALID_HEX';

export class SpeculosBrowserTransportError implements DmkError {
  readonly _tag = 'SpeculosBrowserTransportError';

  constructor(
    readonly errorCode: SpeculosBrowserTransportErrorCode,
    readonly message: string,
    readonly originalError?: unknown,
  ) {}
}

const DEVICE_ID = 'SpeculosBrowserDevice';

class SpeculosBrowserTransport implements Transport {
  private connectedDevice?: TransportConnectedDevice;

  constructor(readonly options: Required<Pick<SpeculosBrowserOptions, 'apduUrl' | 'fetch'>>) {}

  private get deviceModel(): TransportDeviceModel {
    return new TransportDeviceModel({
      id: DeviceModelId.NANO_SP,
      productName: 'Speculos - Ethereum',
      usbProductId: 0x5000,
      bootloaderUsbProductId: 0x0001,
      usbOnly: true,
      memorySize: 1.5 * 1024 * 1024,
      getBlockSize: () => 32,
      masks: [0x33100000],
    });
  }

  getIdentifier(): TransportIdentifier {
    return SPECULOS_BROWSER_IDENTIFIER;
  }

  isSupported(): boolean {
    return true;
  }

  startDiscovering(): Observable<TransportDiscoveredDevice> {
    return of(this.getDiscoveredDevice());
  }

  stopDiscovering(): void {}

  listenToAvailableDevices(): Observable<TransportDiscoveredDevice[]> {
    return of([this.getDiscoveredDevice()]);
  }

  async connect(params: {
    deviceId: DeviceId;
    onDisconnect: DisconnectHandler;
  }): Promise<Either<ConnectError, TransportConnectedDevice>> {
    try {
      const device = new TransportConnectedDevice({
        id: params.deviceId,
        deviceModel: this.deviceModel,
        type: 'USB',
        transport: SPECULOS_BROWSER_IDENTIFIER,
        sendApdu: (apdu) => this.exchange(apdu, params.onDisconnect),
      });
      this.connectedDevice = device;
      return Right(device);
    } catch (cause) {
      return Left(new OpeningConnectionError(cause));
    }
  }

  async disconnect(_params: {
    connectedDevice: TransportConnectedDevice;
  }): Promise<Either<DmkError, void>> {
    this.connectedDevice = undefined;
    return Right(undefined);
  }

  private getDiscoveredDevice(): TransportDiscoveredDevice {
    return {
      id: DEVICE_ID,
      deviceModel: this.deviceModel,
      transport: SPECULOS_BROWSER_IDENTIFIER,
      name: 'Speculos browser emulator',
    };
  }

  private async exchange(
    apdu: Uint8Array,
    onDisconnect: DisconnectHandler,
  ): Promise<Either<DmkError, ApduResponseType>> {
    try {
      const response = await this.options.fetch(this.options.apduUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: bytesToHex(apdu) }),
      });
      if (!response.ok) {
        throw new SpeculosBrowserTransportError(
          'HTTP_FAILURE',
          `Speculos APDU bridge returned HTTP ${response.status}`,
        );
      }
      const payload = (await response.json()) as { data?: unknown };
      if (typeof payload.data !== 'string') {
        throw new SpeculosBrowserTransportError(
          'MALFORMED_RESPONSE',
          'Speculos APDU response has no hex data',
        );
      }
      const bytes = hexToBytes(payload.data);
      if (bytes.length < 2) {
        throw new SpeculosBrowserTransportError(
          'MALFORMED_RESPONSE',
          'Speculos APDU response has no status word',
        );
      }
      return Right(
        new ApduResponse({
          data: bytes.slice(0, -2),
          statusCode: bytes.slice(-2),
        }),
      );
    } catch (cause) {
      const connectedDevice = this.connectedDevice;
      if (connectedDevice) {
        this.connectedDevice = undefined;
        onDisconnect(connectedDevice.id);
      }
      return Left(
        cause instanceof SpeculosBrowserTransportError
          ? cause
          : new SpeculosBrowserTransportError(
              'MALFORMED_RESPONSE',
              'Speculos APDU bridge returned an unreadable response',
              cause,
            ),
      );
    }
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) {
    throw new SpeculosBrowserTransportError(
      'INVALID_HEX',
      'Speculos APDU response contains invalid hex',
    );
  }
  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

export function createSpeculosTransport(
  options: SpeculosBrowserOptions,
): SpeculosBrowserTransportRegistration {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const factory: TransportFactory = (_args: TransportArgs) =>
    new SpeculosBrowserTransport({
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
