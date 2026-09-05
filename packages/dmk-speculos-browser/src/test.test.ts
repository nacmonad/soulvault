import { describe, expect, it, vi } from 'vitest';

import {
  approvalFixture,
  rejectionFixture,
  type SpeculosControllerFixture,
} from './speculos-protocol.fixture.js';
import { createSpeculosController, waitForDeviceScreen } from './test.js';

describe('Speculos test controller', () => {
  it('polls until a matching screen, presses explicitly, and records a transcript', async () => {
    const fetchMock = fixtureFetch(approvalFixture);
    const controller = createSpeculosController({
      apiUrl: 'http://127.0.0.1:5000/',
      fetch: fetchMock,
      pollIntervalMs: 0,
      now: () => new Date('2026-09-05T15:00:00.000Z'),
    });

    await controller.approve();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://127.0.0.1:5000/events?currentscreenonly=true',
      'http://127.0.0.1:5000/events?currentscreenonly=true',
      'http://127.0.0.1:5000/button/both',
    ]);
    expect(controller.getTranscript()).toEqual([
      {
        at: '2026-09-05T15:00:00.000Z',
        kind: 'screen',
        screen: [{ text: 'Review transaction', x: 4, y: 8 }],
      },
      {
        at: '2026-09-05T15:00:00.000Z',
        kind: 'screen',
        screen: [{ text: 'Approve transaction', x: 4, y: 8 }],
      },
      { at: '2026-09-05T15:00:00.000Z', kind: 'button', button: 'both' },
    ]);
  });

  it('drives the checked-in rejection fixture through the explicit reject operation', async () => {
    const fetchMock = fixtureFetch(rejectionFixture);
    const controller = createSpeculosController({
      apiUrl: 'http://speculos',
      fetch: fetchMock,
      pollIntervalMs: 0,
    });

    await controller.reject();

    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('http://speculos/button/left');
    expect(controller.getTranscript().at(-1)).toMatchObject({
      kind: 'button',
      button: rejectionFixture.expectedButton,
    });
  });

  it('bounds screen polling with a deterministic timeout', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
        jsonResponse({ events: [{ text: 'Ethereum is ready' }] }),
      );
      const controller = createSpeculosController({
        apiUrl: 'http://speculos',
        fetch: fetchMock,
        timeoutMs: 25,
        pollIntervalMs: 10,
      });

      const result = waitForDeviceScreen(controller, 'Approve');
      const assertion = expect(result).rejects.toMatchObject({ errorCode: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(30);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects malformed screen-event payloads with a stable error', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ events: [{ text: 42 }] }),
    );
    const controller = createSpeculosController({ apiUrl: 'http://speculos', fetch: fetchMock });

    await expect(controller.pollScreen()).rejects.toMatchObject({
      errorCode: 'MALFORMED_RESPONSE',
    });
  });
});

function fixtureFetch(fixture: SpeculosControllerFixture) {
  const screens = fixture.screens.map((screen) => structuredClone(screen));
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    if (String(input).includes('/events?')) {
      return jsonResponse({ events: screens.shift() ?? [] });
    }
    return new Response(null, { status: 200 });
  });
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
