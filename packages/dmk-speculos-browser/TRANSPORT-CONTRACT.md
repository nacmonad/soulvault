# DMK 1.8 transport contract trace

Pinned references inspected from this workspace:

- `@ledgerhq/device-management-kit@1.8.0` `Transport` and `TransportFactory`
- `@ledgerhq/device-transport-kit-speculos@1.2.1` `SpeculosTransport`

The browser adapter must implement these DMK methods without casts:

- `getIdentifier()` and `isSupported()`
- `startDiscovering()`, `stopDiscovering()`, and `listenToAvailableDevices()`
- `connect({ deviceId, onDisconnect })`
- `disconnect({ connectedDevice })`

A connected device supplies `sendApdu(apdu)`, its transport/device identifiers,
USB-shaped device metadata, and an updated product name parsed from the initial
`B0010000` app/version APDU. Discovery emits one deterministic device. Transport
operations return `Either` values; APDU or connection failures preserve their
cause in DMK errors. Disconnect and failed APDU paths release polling and invoke
the registered disconnect handler once.

The first tracer slice proves the public registration object is explicitly marked
as emulated and that its factory compiles as a DMK 1.8 `TransportFactory`. Network
behavior remains intentionally red until the APDU-exchange slice.
