/**
 * Button press helpers against Speculos `/button` REST endpoint.
 *
 * Semantics:
 *   - left  → previous screen / decline
 *   - right → next screen / advance
 *   - both  → approve / confirm
 */

export type Button = 'left' | 'right' | 'both';

export async function pressButton(apiUrl: string, button: Button): Promise<void> {
  const res = await fetch(`${apiUrl}/button/${button}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'press-and-release' }),
  });
  if (!res.ok) {
    throw new Error(`Speculos button ${button} failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
}

export const pressLeft = (apiUrl: string) => pressButton(apiUrl, 'left');
export const pressRight = (apiUrl: string) => pressButton(apiUrl, 'right');
export const pressBoth = (apiUrl: string) => pressButton(apiUrl, 'both');

/**
 * Reject convenience — presses left on the approve screen. Caller must already
 * be at the approval summary.
 */
export const reject = (apiUrl: string) => pressLeft(apiUrl);
