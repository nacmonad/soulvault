/**
 * Shared helpers for Speculos + hardware Ledger integration suites.
 *
 *   Speculos mode: drive device via /button + /events REST.
 *   Hardware mode: prompt the human operator to confirm on-device.
 *
 * Promise-driven walker: keeps pressing right + handling blind-sign warnings
 * / approve / reject until the signing promise settles. No reliance on
 * matching DISPLAY_CONTRACTS labels on-device — those only appear when
 * Ledger CAL serves our ERC-7730 descriptors upstream. Until then, tests
 * assert that a valid signature is produced and log the captured screens
 * for manual inspection.
 */

import { JsonRpcProvider, Wallet } from 'ethers';
import readline from 'node:readline/promises';
import { pressBoth, pressLeft, pressRight } from './buttons.js';
import { pollEvents, renderHumanChecklist } from './screen.js';
import { ensureFunded } from './funding.js';
import { expectedDisplay, type TypedDataPayload } from '../../src/lib/typed-data.js';

export type Runtime = 'speculos' | 'hardware';

export function detectRuntime(): Runtime {
  return process.env.SOULVAULT_SPECULOS_API_URL ? 'speculos' : 'hardware';
}

export function speculosApiUrl(): string {
  const u = process.env.SOULVAULT_SPECULOS_API_URL;
  if (!u) throw new Error('SOULVAULT_SPECULOS_API_URL not set; Speculos globalSetup must run first.');
  return u;
}

// ─── Device walker ─────────────────────────────────────────────────────────

async function screenTexts(apiUrl: string): Promise<string[]> {
  const events = await pollEvents(apiUrl).catch(() => []);
  return events.map((e) => e.text ?? '').filter(Boolean);
}

/**
 * Drive a Speculos (or hardware) device until the given signing promise settles.
 *
 * Speculos:   auto-walks right, handles blind-sign warning, detects commit/reject.
 *             Returns captured frames (one entry per poll tick).
 * Hardware:   prompts operator to confirm on-device when signing starts, awaits
 *             the promise (the hardware actually performs the prompt).
 *
 * Always returns the frames so tests can log or assert over them.
 */
export async function walkAndCaptureDevice<T>(
  sigPromise: Promise<T>,
  label = 'signing',
  maxSteps = 80,
): Promise<string[][]> {
  const runtime = detectRuntime();
  const frames: string[][] = [];

  if (runtime === 'hardware') {
    // eslint-disable-next-line no-console
    console.log(`\n[device] Hardware signing in progress: ${label}. Confirm on device.`);
    // No automation — just wait. Suppress the unhandled-rejection noise by
    // observing the promise here; the caller still gets the real resolution.
    await Promise.allSettled([sigPromise]);
    return frames;
  }

  const apiUrl = speculosApiUrl();
  const commitMarkers = /approve|accept and send|sign message|sign typed|sign transaction/;
  const warningMarkers = /blind signing ahead|to accept risk/;
  const rejectMarkers = /reject transaction|cancel signature/;

  let settled = false;
  void sigPromise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );

  let prev = '';

  for (let i = 0; i < maxSteps && !settled; i++) {
    const texts = await screenTexts(apiUrl);
    frames.push(texts);
    const joined = texts.join(' | ').toLowerCase();

    if (!joined) {
      await pressRight(apiUrl);
      await new Promise((r) => setTimeout(r, 180));
      continue;
    }

    if (joined !== prev && warningMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log(`[device:${label}] blind-sign warning → both`);
      await pressBoth(apiUrl);
      prev = joined;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (joined !== prev && commitMarkers.test(joined) && !rejectMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log(`[device:${label}] commit → both  (screen: "${joined.slice(0, 80)}")`);
      await pressBoth(apiUrl);
      prev = joined;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (joined !== prev && rejectMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log(`[device:${label}] on reject → left then both`);
      await pressLeft(apiUrl);
      await new Promise((r) => setTimeout(r, 200));
      await pressBoth(apiUrl);
      prev = joined;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    prev = joined;
    await pressRight(apiUrl);
    await new Promise((r) => setTimeout(r, 180));
  }

  if (!settled) {
    // Don't leave the device hung.
    await pressBoth(apiUrl).catch(() => undefined);
  }
  return frames;
}

// ─── Back-compat payload-display helper (no-op text asserts during deferral) ─

/**
 * Drive the device to completion for a typed-data payload. During the current
 * blind-sign deferral, does NOT assert label fragments (labels only show once
 * Ledger CAL serves our descriptors). Once the upstream PR lands and we flip
 * the graduation, change this to match `expectedDisplay(payload)` fragments.
 */
export async function assertPayloadDisplay<T>(
  sigPromise: Promise<string>,
  payload: TypedDataPayload<T>,
): Promise<string[][]> {
  const exp = expectedDisplay(payload);
  return walkAndCaptureDevice(sigPromise, exp.action);
}

/**
 * Drive the device through a raw-tx signing flow. Same semantics as
 * assertPayloadDisplay; distinct helper kept for readable call sites.
 */
export async function approveTxOnDevice(
  sigPromise: Promise<string>,
  label = 'tx',
): Promise<string[][]> {
  return walkAndCaptureDevice(sigPromise, label);
}

// ─── Env + funding ────────────────────────────────────────────────────────

export async function setupFundedEnv(opts: {
  ownerAddress: string;
  secondary?: string[];
}) {
  const rpcUrl = process.env.SOULVAULT_RPC_URL!;
  if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set');
  const provider = new JsonRpcProvider(rpcUrl);
  const pk = process.env.SOULVAULT_PRIVATE_KEY;
  if (!pk) throw new Error('SOULVAULT_PRIVATE_KEY not set — required as funder key.');
  const funder = new Wallet(pk, provider);
  const funded = await ensureFunded({
    rpcUrl,
    ownerAddress: opts.ownerAddress,
    secondaryAccounts: opts.secondary,
    funderWallet: funder,
  });
  return { provider, funder, funded };
}

/** @deprecated Prefer the `funder` returned by setupFundedEnv. */
export function testFunderWallet(provider: JsonRpcProvider): Wallet {
  const pk = process.env.SOULVAULT_PRIVATE_KEY;
  if (!pk) throw new Error('SOULVAULT_PRIVATE_KEY not set.');
  return new Wallet(pk, provider);
}

// ─── Nonce-fresh send wrapper ────────────────────────────────────────────

/**
 * Send a transaction from `wallet` with an explicit fresh `latest` nonce.
 * Prevents cross-test-file collisions where multiple Wallet instances
 * (same key) cache stale pending nonces.
 */
export async function sendWithFreshNonce(
  wallet: Wallet,
  tx: { to?: string; value?: bigint; data?: string },
  retries = 3,
) {
  const provider = wallet.provider;
  if (!provider) throw new Error('wallet has no provider');
  const addr = await wallet.getAddress();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const nonce = await provider.getTransactionCount(addr, 'latest');
    try {
      const sent = await wallet.sendTransaction({ ...tx, nonce });
      await sent.wait(1);
      return sent;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!/nonce|replacement/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw lastErr;
}

/**
 * Return the device to app home between tests. Best-effort — swallows errors.
 * Prevents the DMK session from seeing an unexpected screen when the next
 * test starts a sign action.
 */
export async function resetDeviceToHome(): Promise<void> {
  if (detectRuntime() !== 'speculos') return;
  const apiUrl = speculosApiUrl();
  for (let i = 0; i < 6; i++) {
    try {
      await pressLeft(apiUrl);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      return;
    }
  }
}

/** Call a contract method via `wallet` with an explicit fresh nonce. */
export async function callWithFreshNonce(
  wallet: Wallet,
  contract: { connect: (s: Wallet) => unknown },
  method: string,
  args: unknown[] = [],
) {
  const provider = wallet.provider;
  if (!provider) throw new Error('wallet has no provider');
  const addr = await wallet.getAddress();
  const nonce = await provider.getTransactionCount(addr, 'latest');
  const connected = contract.connect(wallet) as Record<string, (...a: unknown[]) => Promise<{ wait: (c: number) => Promise<unknown> }>>;
  const fn = connected[method];
  if (typeof fn !== 'function') throw new Error(`callWithFreshNonce: ${method} is not a function`);
  const tx = await fn(...args, { nonce });
  await tx.wait(1);
  return tx;
}

// ─── Hardware-only human checklist ────────────────────────────────────────

export async function confirmOnHardware(label: string, checklist: string[] = []): Promise<void> {
  if (detectRuntime() === 'speculos') return;
  const msg = renderHumanChecklist(label, checklist);
  // eslint-disable-next-line no-console
  console.log(`\n${msg}\n`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const ans = (await rl.question('Display correct on device? [y/N] ')).trim().toLowerCase();
    if (ans !== 'y') throw new Error(`Operator rejected: ${label}`);
  } finally {
    rl.close();
  }
}
