/**
 * Auto-configure the Ethereum app inside Speculos.
 *
 * Navigation path for Nano S+/X Ethereum app (version ~1.10.x):
 *   Home → right → "Settings" → both → first setting ("Blind signing") → both
 *     (toggles Not enabled / Enabled) → left (back) → left (home)
 *
 * Layout shifts between app versions, so this walker searches for text rather
 * than hard-coding step counts. Idempotent: if blind signing is already on,
 * it detects "Enabled" and backs out without toggling.
 */

import { pressBoth, pressLeft, pressRight } from './buttons.js';
import { pollEvents } from './screen.js';

export interface ConfigureOptions {
  apiUrl?: string;
  maxSteps?: number;
  debug?: boolean;
}

async function screenText(apiUrl: string): Promise<string> {
  const events = await pollEvents(apiUrl).catch(() => []);
  return events.map((e) => e.text ?? '').join(' | ').toLowerCase();
}

async function walkRightUntil(
  apiUrl: string,
  predicate: (text: string) => boolean,
  maxSteps = 20,
  debug = false,
): Promise<string> {
  for (let i = 0; i < maxSteps; i++) {
    const t = await screenText(apiUrl);
    if (debug) console.log(`[configure-app] step ${i}: "${t}"`);
    if (predicate(t)) return t;
    await pressRight(apiUrl);
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`walkRightUntil: predicate not satisfied after ${maxSteps} steps (last screen: "${await screenText(apiUrl)}")`);
}

export async function enableBlindSigning(opts: ConfigureOptions = {}): Promise<boolean> {
  const apiUrl = opts.apiUrl ?? process.env.SOULVAULT_SPECULOS_API_URL ?? 'http://127.0.0.1:5000';
  const debug = opts.debug ?? true;
  const maxSteps = opts.maxSteps ?? 25;

  // Start from a known state: press left twice to escape any transient screen.
  await pressLeft(apiUrl).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 150));

  // From app home, advance to Settings.
  if (debug) console.log('[configure-app] searching for Settings');
  await walkRightUntil(apiUrl, (t) => /settings/.test(t), maxSteps, debug);
  await pressBoth(apiUrl);
  await new Promise((r) => setTimeout(r, 300));

  // Inside Settings: find the "Blind signing" entry.
  if (debug) console.log('[configure-app] searching for Blind signing entry');
  const blindEntry = await walkRightUntil(
    apiUrl,
    (t) => /blind sign/.test(t),
    maxSteps,
    debug,
  );

  // Check if already enabled. Entry screen usually shows "Blind signing" + state
  // on a single screen (Nano X) or across adjacent screens (Nano S+).
  const alreadyEnabled = /enabled/.test(blindEntry) && !/not enabled/.test(blindEntry);
  if (alreadyEnabled) {
    if (debug) console.log('[configure-app] blind signing already enabled');
  } else {
    if (debug) console.log('[configure-app] toggling blind signing ON');
    await pressBoth(apiUrl);
    await new Promise((r) => setTimeout(r, 300));
  }

  // Navigate back to home: press left a few times until screen shows "Ethereum" (app home)
  for (let i = 0; i < 10; i++) {
    const t = await screenText(apiUrl);
    if (/ethereum/.test(t) && /app is ready|ready/.test(t)) break;
    await pressLeft(apiUrl);
    await new Promise((r) => setTimeout(r, 150));
  }

  if (debug) console.log('[configure-app] done; final screen:', await screenText(apiUrl));
  return !alreadyEnabled;
}
