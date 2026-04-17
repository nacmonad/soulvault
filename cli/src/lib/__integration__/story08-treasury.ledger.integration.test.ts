/**
 * Story 08 — Treasury deploy + fund approval.
 *
 * Runs identically against Speculos (auto-walker) and hardware (operator
 * confirms on device). The runtime branch lives inside walkAndCaptureDevice.
 *
 * Assertions during blind-sign deferral: signatures are real + device
 * interaction is captured. Field-label assertions graduate automatically
 * once Ledger CAL serves our descriptors — see docs/clear-signing-submission-runbook.md.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, parseEther } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import {
  setupFundedEnv,
  walkAndCaptureDevice,
  sendWithFreshNonce,
  resetDeviceToHome,
} from '../../../test/speculos/suite-helpers.js';
import {
  buildSetTreasury,
  buildApproveFundRequest,
  defaultDeadline,
} from '../typed-data.js';
import { createSigner, signTypedDataWithMode, type SoulVaultSigner } from '../signer.js';

describe('story08 — treasury flow [hardware]', () => {
  let provider: JsonRpcProvider;
  let funder: Wallet;
  let owner: SoulVaultSigner;
  let ownerAddr: string;
  let alice: Wallet;
  let swarm: Contract;
  let treasury: Contract;
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
    treasury = (await deployContract(funder, loadForgeArtifact('SoulVaultTreasury'), [])) as unknown as Contract;
  }, 300_000);

  afterEach(async () => { await resetDeviceToHome(); });

  it('owner signs SetTreasury → relayer submits → state changes on-chain', async () => {
    const deadline = defaultDeadline();
    const nonce = await swarm.ownerNonce();
    const payload = buildSetTreasury(await swarm.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      treasury: await treasury.getAddress(),
      nonce,
      deadline,
    });
    const sigP = signTypedDataWithMode(
      owner,
      payload.domain,
      payload.types,
      payload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(sigP, 'SetTreasury');
    const sig = await sigP;
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);

    // Relayer (funder) submits the signed intent.
    const tx = await (swarm.connect(funder) as Contract).setTreasuryWithSig(
      await treasury.getAddress(),
      nonce,
      deadline,
      sig,
    );
    await tx.wait(1);
    expect((await swarm.treasury()).toLowerCase()).toBe((await treasury.getAddress()).toLowerCase());
    expect(await swarm.ownerNonce()).toBe(nonce + 1n);
  }, 180_000);

  it('owner signs ApproveFundRequest → relayer submits → funds flow', async () => {
    // Onboard alice + seed a fund request (submitter-side = funder/alice, not owner)
    const joinNonce = await swarm.ownerNonce();
    const joinDeadline = defaultDeadline();
    await (swarm.connect(alice) as Contract).requestJoin('0x02' + 'aa'.repeat(32), '', '');
    // Owner approves join via EIP-712 too (since msg.sender auth would require owner EOA to call)
    const approveJoinPayload = {
      domain: {
        name: 'SoulVaultSwarm', version: '1', chainId,
        verifyingContract: await swarm.getAddress(),
      },
      types: {
        ApproveJoin: [
          { name: 'swarm', type: 'address' },
          { name: 'requestId', type: 'uint256' },
          { name: 'requester', type: 'address' },
          { name: 'nonce', type: 'uint64' },
          { name: 'deadline', type: 'uint64' },
        ],
      },
      primaryType: 'ApproveJoin',
      message: {
        swarm: await swarm.getAddress(),
        requestId: 1n,
        requester: alice.address,
        nonce: joinNonce,
        deadline: joinDeadline,
      },
    };
    const joinSigP = signTypedDataWithMode(
      owner, approveJoinPayload.domain, approveJoinPayload.types,
      approveJoinPayload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(joinSigP, 'ApproveJoin');
    const joinSig = await joinSigP;
    await (await (swarm.connect(funder) as Contract).approveJoinWithSig(1, alice.address, joinNonce, joinDeadline, joinSig)).wait(1);

    // Alice requests funds
    await (await (swarm.connect(alice) as Contract).requestFunds(parseEther('1'), 'coffee')).wait(1);

    // Fund treasury
    await funder.sendTransaction({ to: await treasury.getAddress(), value: parseEther('5') });

    // Owner signs ApproveFundRequest; relayer submits
    const treasuryNonce = await treasury.ownerNonce();
    const deadline = defaultDeadline();
    const payload = buildApproveFundRequest(await treasury.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      requestId: 1n,
      amount: parseEther('1'),
      recipient: alice.address,
      nonce: treasuryNonce,
      deadline,
    });
    const sigP = signTypedDataWithMode(
      owner, payload.domain, payload.types,
      payload.message as Record<string, unknown>,
      { clearSign: 'clear-sign-preferred' },
    );
    await walkAndCaptureDevice(sigP, 'ApproveFundRequest');
    const sig = await sigP;

    const aliceBalBefore = await provider.getBalance(alice.address);
    await (await (treasury.connect(funder) as Contract).approveFundRequestWithSig(
      await swarm.getAddress(), 1n, parseEther('1'), alice.address, treasuryNonce, deadline, sig,
    )).wait(1);
    const aliceBalAfter = await provider.getBalance(alice.address);
    expect(aliceBalAfter - aliceBalBefore).toBe(parseEther('1'));
    expect(await treasury.ownerNonce()).toBe(treasuryNonce + 1n);
  }, 300_000);

  it('negative: bad signer (alice) cannot forge owner intent', async () => {
    // Alice is not the owner — a signature by her for SetTreasury must be rejected.
    const nonce = await swarm.ownerNonce();
    const deadline = defaultDeadline();
    const payload = buildSetTreasury(await swarm.getAddress(), chainId, {
      swarm: await swarm.getAddress(),
      treasury: await treasury.getAddress(),
      nonce,
      deadline,
    });
    const badSig = await alice.signTypedData(payload.domain, payload.types, payload.message);
    await expect(
      (swarm.connect(funder) as Contract).setTreasuryWithSig(
        await treasury.getAddress(), nonce, deadline, badSig,
      ),
    ).rejects.toThrow();
  });
});
