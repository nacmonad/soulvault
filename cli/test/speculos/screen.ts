/**
 * Screen assertion helpers for Speculos.
 *
 * The Speculos REST API exposes two useful surfaces:
 *   - GET /events      — long-poll stream of "text" events (string rendered on screen)
 *   - GET /screenshot  — PNG of current device screen
 *
 * We prefer `/events` because rendered text is already extracted; fall back to
 * `/screenshot` only when we need to diff an exact pixel layout.
 */

export interface SpeculosEvent {
  text: string;
  x?: number;
  y?: number;
}

export async function pollEvents(apiUrl: string, timeoutMs = 5000): Promise<SpeculosEvent[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl}/events?currentscreenonly=true`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`/events ${res.status}`);
    const body = (await res.json()) as { events?: SpeculosEvent[] };
    return body.events ?? [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Waits until the device shows text that satisfies `predicate`, polling every `intervalMs`.
 * Resolves with the matching event; rejects on timeout.
 */
export async function waitForText(
  apiUrl: string,
  predicate: (text: string) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<SpeculosEvent> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 200;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await pollEvents(apiUrl, 2000).catch(() => []);
    const match = events.find((e) => predicate(e.text ?? ''));
    if (match) return match;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitForText: timed out after ${timeoutMs}ms`);
}

/**
 * Assert an ordered sequence of text fragments appears on-device. After each match
 * it presses the "right" button to advance (Nano X/S swipe-right semantics), so
 * the caller gets the natural review flow. Caller is responsible for the final
 * approve (press both) at the summary.
 */
export async function assertDisplaySequence(
  apiUrl: string,
  fragments: string[],
  opts: { pressRight?: (apiUrl: string) => Promise<void>; timeoutPerFragmentMs?: number } = {},
): Promise<void> {
  const pressRight = opts.pressRight;
  for (const frag of fragments) {
    await waitForText(apiUrl, (t) => t.toLowerCase().includes(frag.toLowerCase()), {
      timeoutMs: opts.timeoutPerFragmentMs ?? 10_000,
    });
    if (pressRight) {
      await pressRight(apiUrl);
    }
  }
}

/** Hardware checklist rendering — mirrors assertDisplaySequence for the paired human-run suite. */
export function renderHumanChecklist(action: string, fragments: string[]): string {
  return [
    `── Hardware display checklist: ${action} ──`,
    ...fragments.map((f, i) => `  ${String(i + 1).padStart(2, ' ')}. Device should show: "${f}"`),
    '  Confirm on device once all items verified. Type "y" to acknowledge, "n" to fail.',
  ].join('\n');
}
