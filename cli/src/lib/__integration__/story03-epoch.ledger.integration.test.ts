/**
 * Story 03 — Epoch rotation: owner signs RotateEpoch (EIP-712).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, keccak256, parseEther, toUtf8Bytes } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import {
  setupFundedEnv,
  walkAndCaptureDevice,
  sendWithFreshNonce,
  resetDeviceToHome,
} from '../../../test/speculos/suite-helpers.js';
import { buildRotateEpoch, defaultDeadline } from '../typed-data.js';
import { createSigner, signTypedDataWithMode, type SoulVaultSigner } from '../signer.js';

describe('story03 — epoch rotation [hardware]', () => {
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

  it('owner signs RotateEpoch → relayer submits → epoch advances', async () => {
    const bundleHash = keccak256(toUtf8Bytes('bundle-v1'));
    const nonce = await swarm.ownerNonce();
    const deadline = defaultDeadline();
    const payload = buildRotateEpoch(await swarm.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      fromEpoch: 0n,
      toEpoch: 1n,
      bundleManifestHash: bundleHash,
      nonce,
      deadline,
    });
    const sigP = signTypedDataWithMode(
      owner, payload.domain, payload.types,
      payload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(sigP, 'RotateEpoch');
    const sig = await sigP;

    await (await (swarm.connect(funder) as Contract).rotateEpochWithSig(
      1n, 'ref', bundleHash, 0n, 0n, bundleHash, nonce, deadline, sig,
    )).wait(1);
    expect(await swarm.currentEpoch()).toBe(1n);
    expect(await swarm.ownerNonce()).toBe(nonce + 1n);
  }, 180_000);

  it('negative: non-owner rotateEpoch reverts on-chain', async () => {
    await expect(
      (swarm.connect(alice) as Contract).rotateEpoch(1, 'ref', '0x' + '00'.repeat(32), 0),
    ).rejects.toThrow();
  });
});
