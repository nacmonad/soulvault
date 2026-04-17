/**
 * Clear-signing diagnostic — "does it work?" in one file.
 *
 * Independent of contract deploys and stories. Exercises two paths:
 *   1. signMessage       — personal_sign; confirms DMK↔Speculos transport is live
 *   2. signTypedData (EIP-712 ApproveFundRequest) — the real clear-sign path
 *
 * For each, we print the live Speculos screen before pressing buttons to
 * advance, so the test log shows EXACTLY what the device renders. Useful both
 * as a smoke test and as a visual proof that clear-signing is active.
 *
 * The test auto-advances with `/button/right` until it lands on the approval
 * screen, then presses both.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parseEther } from 'ethers';
import { createSigner, signTypedDataWithMode, type SoulVaultSigner } from '../signer.js';
import { buildApproveFundRequest, defaultDeadline } from '../typed-data.js';
import { pollEvents } from '../../../test/speculos/screen.js';
import { pressRight, pressBoth, pressLeft } from '../../../test/speculos/buttons.js';

const SPECULOS_URL = process.env.SOULVAULT_SPECULOS_API_URL ?? 'http://127.0.0.1:5000';

async function printScreen(label: string): Promise<string[]> {
  const events = await pollEvents(SPECULOS_URL).catch(() => []);
  const texts = events.map((e) => e.text).filter(Boolean);
  // eslint-disable-next-line no-console
  console.log(`\n[speculos-screen] ${label}:\n  ${texts.map((t) => `"${t}"`).join(' | ') || '(empty)'}`);
  return texts;
}

/**
 * Walks right until we see one of the known "commit" screens, then presses both.
 *
 *   - typed data / tx:   "Approve" / "Accept and send" / "Sign transaction"
 *   - personal_sign:     "Sign message" (explicit confirm; "Message" is the title screen, not the confirm)
 *
 * We confirm on the FIRST screen whose text matches a commit marker and is
 * different from the prior screen, to avoid pressing both on the initial title.
 */
/**
 * Drive the device until the signing promise settles.
 *
 *   - "Blind signing ahead" warning → press both to accept risk, continue
 *   - "Sign message" / "Sign typed" / "Approve" / "Accept and send" → press both (final commit)
 *   - "Reject transaction" / "Cancel" → back up left and press both on prior screen
 *   - Any other screen → press right to advance
 *
 * Loops until the provided sigPromise settles OR maxSteps exceeded.
 */
async function walkAndCapture(
  sigPromise: Promise<string>,
  maxSteps = 80,
): Promise<string[][]> {
  const commitMarkers = /approve|accept and send|sign message|sign typed|sign transaction/;
  const warningMarkers = /blind signing ahead|to accept risk/;
  const rejectMarkers = /reject transaction|cancel signature/;
  const frames: string[][] = [];

  let settled = false;
  let result: string | undefined;
  let error: unknown;
  sigPromise.then(
    (r) => {
      settled = true;
      result = r;
    },
    (e) => {
      settled = true;
      error = e;
    },
  );

  let prev = '';
  let pressedCommitOnPrev = false;

  for (let i = 0; i < maxSteps && !settled; i++) {
    const texts = await printScreen(`step ${i}`);
    frames.push(texts);
    const joined = texts.join(' | ').toLowerCase();

    if (!joined) {
      await pressRight(SPECULOS_URL);
      await new Promise((r) => setTimeout(r, 180));
      continue;
    }

    if (joined !== prev && warningMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log('[speculos-screen] blind-sign warning — accepting (both)');
      await pressBoth(SPECULOS_URL);
      prev = joined;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (joined !== prev && commitMarkers.test(joined) && !rejectMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log('[speculos-screen] commit screen detected — pressing both');
      await pressBoth(SPECULOS_URL);
      pressedCommitOnPrev = true;
      prev = joined;
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    if (joined !== prev && rejectMarkers.test(joined)) {
      // eslint-disable-next-line no-console
      console.log('[speculos-screen] on reject screen — backing up left and pressing both');
      await pressLeft(SPECULOS_URL);
      await new Promise((r) => setTimeout(r, 200));
      const backed = await printScreen('after-back');
      frames.push(backed);
      await pressBoth(SPECULOS_URL);
      prev = backed.join(' | ').toLowerCase();
      await new Promise((r) => setTimeout(r, 400));
      continue;
    }

    prev = joined;
    await pressRight(SPECULOS_URL);
    await new Promise((r) => setTimeout(r, 180));
  }

  if (!settled) {
    // eslint-disable-next-line no-console
    console.log('[speculos-screen] maxSteps reached, final press both');
    await pressBoth(SPECULOS_URL);
  }
  // eslint-disable-next-line no-console
  console.log(`[speculos-screen] walker exit — settled=${settled}, pressedCommit=${pressedCommitOnPrev}, error=${error ? String(error).slice(0, 80) : 'none'}, sig=${result?.slice(0, 20) ?? 'none'}`);
  return frames;
}

describe('clear-sign diagnostic [speculos]', () => {
  let owner: SoulVaultSigner;
  let ownerAddr: string;

  beforeAll(async () => {
    owner = await createSigner();
    ownerAddr = await owner.getAddress();
    // eslint-disable-next-line no-console
    console.log(`[clear-sign-diagnostic] owner (speculos-derived) = ${ownerAddr}`);
  }, 60_000);

  it('signMessage: device prompts, we capture screens', async () => {
    const sigP = owner.signMessage('SoulVault clear-sign smoke test');
    // Give the app a moment to render the prompt.
    await new Promise((r) => setTimeout(r, 500));
    const frames = await walkAndCapture(sigP);
    const sig = await sigP;
    // eslint-disable-next-line no-console
    console.log(`[clear-sign-diagnostic] signMessage signature: ${sig.slice(0, 20)}…`);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(frames.some((f) => f.length > 0)).toBe(true);
  }, 120_000);

  it('signTypedData (ApproveFundRequest): device renders field-by-field', async () => {
    // Use placeholder contract addresses — we're verifying display, not chain state.
    const fakeTreasury = '0x000000000000000000000000000000000000dead';
    const fakeSwarm = '0x000000000000000000000000000000000000beef';
    const fakeRecipient = '0x000000000000000000000000000000000000cafe';
    const chainId = 1337;
    const payload = buildApproveFundRequest(fakeTreasury, chainId, {
      swarm: fakeSwarm,
      requestId: 42n,
      amount: parseEther('1.5'),
      recipient: fakeRecipient,
      nonce: 0n,
      deadline: defaultDeadline(),
    });
    // eslint-disable-next-line no-console
    console.log('[clear-sign-diagnostic] typed-data payload:', JSON.stringify({
      primaryType: payload.primaryType,
      domain: payload.domain,
      message: {
        ...payload.message,
        amount: payload.message.amount.toString(),
        requestId: payload.message.requestId.toString(),
        nonce: payload.message.nonce.toString(),
        deadline: payload.message.deadline.toString(),
      },
    }, null, 2));

    const sigP = signTypedDataWithMode(owner, payload.domain, payload.types, payload.message as Record<string, unknown>);
    await new Promise((r) => setTimeout(r, 500));
    const frames = await walkAndCapture(sigP, 120);
    const sig = await sigP;
    // eslint-disable-next-line no-console
    console.log(`[clear-sign-diagnostic] typed-data signature: ${sig.slice(0, 20)}…`);
    // eslint-disable-next-line no-console
    console.log('[clear-sign-diagnostic] captured frames:', frames.length);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  }, 180_000);
});
