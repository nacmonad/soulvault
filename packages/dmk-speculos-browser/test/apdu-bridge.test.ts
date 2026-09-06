import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { startApduBridge, type ApduBridge } from './apdu-bridge.js';

describe('APDU browser bridge', () => {
  let bridge: ApduBridge | undefined;
  let upstream: ReturnType<typeof createServer> | undefined;

  afterEach(async () => {
    await bridge?.stop();
    await new Promise<void>((resolve) => upstream?.close(() => resolve()) ?? resolve());
  });

  it('forwards APDUs and supplies browser CORS headers', async () => {
    upstream = createServer((request, response) => {
      expect(request.url).toBe('/apdu');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: '9000' }));
    });
    await new Promise<void>((resolve) => upstream!.listen(0, '127.0.0.1', resolve));
    const address = upstream.address();
    if (!address || typeof address === 'string') throw new Error('upstream did not bind');
    bridge = await startApduBridge(`http://127.0.0.1:${address.port}`);

    const preflight = await fetch(bridge.apduUrl, { method: 'OPTIONS' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*');
    expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
    const response = await fetch(bridge.apduUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: 'e002000000' }),
    });
    expect(await response.json()).toEqual({ data: '9000' });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });
});
