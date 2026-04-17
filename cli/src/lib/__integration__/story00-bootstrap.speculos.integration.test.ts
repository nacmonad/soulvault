/**
 * Story 00 — Bootstrap org + swarm: approveJoin signing.
 *
 * ENS commit is intentionally omitted from automation: the selector has no CAL
 * descriptor and Speculos ships the Ethereum app without ENS commit support
 * baked in; it's covered on hardware via operator checklist in the ledger suite.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import {
  setupFundedEnv,
  walkAndCaptureDevice,
  sendWithFreshNonce,
  resetDeviceToHome,
} from '../../../test/speculos/suite-helpers.js';
import { buildApproveJoin, defaultDeadline } from '../typed-data.js';
import { createSigner, signTypedDataWithMode, type SoulVaultSigner } from '../signer.js';

describe('story00 — bootstrap [speculos|hardware]', () => {
  let provider: JsonRpcProvider;
  let funder: Wallet;
  let owner: SoulVaultSigner;
  let ownerAddr: string;
  let alice: Wallet;
  let swarm: Contract;
  let chainId: number;

  beforeAll(async () => {
    owner = await createSigner();
    ownerAddr = await owner.getAddress();
    const env = await setupFundedEnv({ ownerAddress: ownerAddr });
    provider = env.provider;
    funder = env.funder;
    chainId = Number((await provider.getNetwork()).chainId);
    alice = Wallet.createRandom().connect(provider);
    await sendWithFreshNonce(funder, { to: alice.address, value: parseEther('10') });
    swarm = (await deployContract(funder, loadForgeArtifact('SoulVaultSwarm'), [])) as unknown as Contract;
  }, 300_000);

  afterEach(async () => { await resetDeviceToHome(); });

  it('owner signs ApproveJoin → relayer submits → alice becomes member', async () => {
    // Seed a join request from alice
    await (await (swarm.connect(alice) as Contract).requestJoin('0x02' + 'aa'.repeat(32), '', '')).wait(1);

    const nonce = await swarm.ownerNonce();
    const deadline = defaultDeadline();
    const payload = buildApproveJoin(await swarm.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      requestId: 1n,
      requester: alice.address,
      nonce,
      deadline,
    });
    const sigP = signTypedDataWithMode(
      owner, payload.domain, payload.types,
      payload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(sigP, 'ApproveJoin');
    const sig = await sigP;

    await (await (swarm.connect(funder) as Contract).approveJoinWithSig(
      1n, alice.address, nonce, deadline, sig,
    )).wait(1);
    expect(await swarm.isActiveMember(alice.address)).toBe(true);
    expect(await swarm.ownerNonce()).toBe(nonce + 1n);
  }, 300_000);

  it('negative: non-owner approveJoin reverts on-chain', async () => {
    await expect((swarm.connect(alice) as Contract).approveJoin(1)).rejects.toThrow();
  });
});
