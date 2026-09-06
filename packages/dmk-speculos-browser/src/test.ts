export type SpeculosButton = 'left' | 'right' | 'both';

export type SpeculosScreenEvent = {
  text: string;
  x?: number;
  y?: number;
};

export type SpeculosTranscriptEntry = {
  at: string;
  kind: 'screen' | 'button';
  screen?: SpeculosScreenEvent[];
  button?: SpeculosButton;
};

export type DeviceScreenMatcher = string | RegExp | ((text: string) => boolean);

export type SpeculosControllerOptions = {
  apiUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => Date;
};

export class SpeculosControllerError extends Error {
  readonly name = 'SpeculosControllerError';

  constructor(
    readonly errorCode: 'HTTP_FAILURE' | 'MALFORMED_RESPONSE' | 'TIMEOUT',
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
  }
}

export type SpeculosController = ReturnType<typeof createSpeculosController>;

export function createSpeculosController(options: SpeculosControllerOptions) {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const now = options.now ?? (() => new Date());
  const transcript: SpeculosTranscriptEntry[] = [];

  const pollScreen = async (): Promise<SpeculosScreenEvent[]> => {
    const response = await fetchWithTimeout(
      fetchImplementation,
      `${trimTrailingSlash(options.apiUrl)}/events?currentscreenonly=true`,
      { method: 'GET' },
      timeoutMs,
    );
    if (!response.ok) {
      throw new SpeculosControllerError(
        'HTTP_FAILURE',
        `Speculos events endpoint returned HTTP ${response.status}`,
      );
    }
    const payload = (await response.json()) as { events?: unknown };
    if (!Array.isArray(payload.events) || !payload.events.every(isScreenEvent)) {
      throw new SpeculosControllerError(
        'MALFORMED_RESPONSE',
        'Speculos events endpoint returned malformed events',
      );
    }
    const screen = payload.events.map((event) => ({ ...event }));
    transcript.push({ at: now().toISOString(), kind: 'screen', screen });
    return screen;
  };

  const waitForScreen = async (
    matcher: DeviceScreenMatcher,
    waitOptions: { timeoutMs?: number; pollIntervalMs?: number } = {},
  ): Promise<SpeculosScreenEvent[]> => {
    const waitTimeoutMs = waitOptions.timeoutMs ?? timeoutMs;
    const intervalMs = waitOptions.pollIntervalMs ?? pollIntervalMs;
    const deadline = Date.now() + waitTimeoutMs;
    do {
      const screen = await pollScreen();
      if (screen.some((event) => matchesScreen(matcher, event.text))) return screen;
      if (Date.now() >= deadline) break;
      await delay(intervalMs);
    } while (Date.now() < deadline);
    throw new SpeculosControllerError(
      'TIMEOUT',
      `Timed out after ${waitTimeoutMs}ms waiting for the Speculos screen`,
    );
  };

  const press = async (button: SpeculosButton): Promise<void> => {
    const response = await fetchWithTimeout(
      fetchImplementation,
      `${trimTrailingSlash(options.apiUrl)}/button/${button}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'press-and-release' }),
      },
      timeoutMs,
    );
    if (!response.ok) {
      throw new SpeculosControllerError(
        'HTTP_FAILURE',
        `Speculos button ${button} returned HTTP ${response.status}`,
      );
    }
    transcript.push({ at: now().toISOString(), kind: 'button', button });
  };

  return {
    pollScreen,
    waitForScreen,
    pressLeft: () => press('left'),
    pressRight: () => press('right'),
    pressBoth: () => press('both'),
    approve: async (matcher: DeviceScreenMatcher = /approve|accept and send|sign/i) => {
      await waitForScreen(matcher);
      await press('both');
    },
    reject: async (matcher: DeviceScreenMatcher = /approve|accept and send|sign/i) => {
      await waitForScreen(matcher);
      await press('left');
    },
    getTranscript: (): readonly SpeculosTranscriptEntry[] => structuredClone(transcript),
  };
}

export async function waitForDeviceScreen(
  controller: SpeculosController,
  matcher: DeviceScreenMatcher,
  options?: { timeoutMs?: number; pollIntervalMs?: number },
): Promise<SpeculosScreenEvent[]> {
  return controller.waitForScreen(matcher, options);
}

async function fetchWithTimeout(
  fetchImplementation: typeof globalThis.fetch,
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImplementation(input, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new SpeculosControllerError('TIMEOUT', `Speculos request timed out after ${timeoutMs}ms`, cause);
    }
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}

function isScreenEvent(value: unknown): value is SpeculosScreenEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.text === 'string'
    && (event.x === undefined || typeof event.x === 'number')
    && (event.y === undefined || typeof event.y === 'number');
}

function matchesScreen(matcher: DeviceScreenMatcher, text: string): boolean {
  if (typeof matcher === 'string') return text.toLowerCase().includes(matcher.toLowerCase());
  if (matcher instanceof RegExp) {
    matcher.lastIndex = 0;
    return matcher.test(text);
  }
  return matcher(text);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
