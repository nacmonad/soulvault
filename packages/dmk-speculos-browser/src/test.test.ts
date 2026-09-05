import { describe, expect, it, vi } from 'vitest';

import { createSpeculosController, waitForDeviceScreen } from './test.js';

describe('Speculos test controller', () => {
  it('polls until a matching screen, presses explicitly, and records a transcript', async () => {
    const responses = [
      jsonResponse({ events: [{ text: 'Review transaction', x: 4, y: 8 }] }),
      jsonResponse({ events: [{ text: 'Approve transaction', x: 4, y: 8 }] }),
      new Response(null, { status: 200 }),
    ];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => responses.shift()!);
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

  it('supports string screen matching and explicit rejection', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ events: [{ text: 'Reject transaction' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const controller = createSpeculosController({ apiUrl: 'http://speculos', fetch: fetchMock });

    expect(await waitForDeviceScreen(controller, 'reject')).toEqual([
      { text: 'Reject transaction' },
    ]);
    await controller.pressLeft();

    expect(fetchMock.mock.calls[1]?.[0]).toBe('http://speculos/button/left');
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
