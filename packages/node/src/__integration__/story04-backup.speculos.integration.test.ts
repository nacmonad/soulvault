/**
 * Story 04 — Backup request: owner signs BackupRequest (EIP-712).
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, keccak256, parseEther, toUtf8Bytes } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import {
  setupFundedEnv,
  walkAndCaptureDevice,
  sendWithFreshNonce,
  resetDeviceToHome,
} from '../../../test/speculos/suite-helpers.js';
import { buildBackupRequest, defaultDeadline } from '../typed-data.js';
import { createSigner, signTypedDataWithMode, type SoulVaultSigner } from '../signer.js';

describe('story04 — backup request [speculos|hardware]', () => {
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
    swarm = (await deployContract(funder, loadForgeArtifact('SoulVaultSwarm'), [ZeroAddress])) as unknown as Contract;
  }, 300_000);

  afterEach(async () => { await resetDeviceToHome(); });

  it('owner signs BackupRequest → relayer submits → event emitted', async () => {
    const trigger = keccak256(toUtf8Bytes('scheduled'));
    const nonce = await swarm.ownerNonce();
    const sigDeadline = defaultDeadline();
    const payload = buildBackupRequest(await swarm.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      epoch: 0n,
      trigger,
      nonce,
      deadline: sigDeadline,
    });
    const sigP = signTypedDataWithMode(
      owner, payload.domain, payload.types,
      payload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(sigP, 'BackupRequest');
    const sig = await sigP;

    const backupDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const tx = await (swarm.connect(funder) as Contract).requestBackupWithSig(
      0n, trigger, 'scheduled backup', 'ipfs://target', backupDeadline, nonce, sigDeadline, sig,
    );
    const receipt = await tx.wait(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((receipt as any).logs.length).toBeGreaterThan(0);
    expect(await swarm.ownerNonce()).toBe(nonce + 1n);
  }, 180_000);

  it('negative: non-owner requestBackup reverts on-chain', async () => {
    await expect(
      (swarm.connect(alice) as Contract).requestBackup(1, 'reason', 'ref', Math.floor(Date.now() / 1000) + 3600),
    ).rejects.toThrow();
  });
});
