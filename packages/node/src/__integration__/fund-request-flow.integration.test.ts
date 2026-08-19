import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import fs from 'fs-extra';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import { createOrganizationProfile } from '../organization.js';
import { createSwarmProfile } from '../swarm.js';
import { buildTreasuryProfile, writeTreasuryProfile } from '../treasury.js';
import {
  listFundRequests,
  listRecentSwarmEvents,
  getFundRequestStatus,
  SOULVAULT_SWARM_ABI,
} from '../swarm-contract.js';
import {
  approveFundRequestViaTreasury,
  depositToTreasury,
  getTreasuryStatus,
  rejectFundRequestViaTreasury,
} from '../treasury-contract.js';
import { resolveCliStateDir } from '../paths.js';

/**
 * Full-stack CLI integration test for feat/agent-request-funds.
 *
 * Exercises the real CLI lib functions end-to-end against a locally-deployed
 * SoulVaultSwarm + SoulVaultTreasury on the user's ens-app-v3 chain. Foundry
 * already covers contract-level edge cases exhaustively (50/50 tests in
 * test/SoulVaultSwarm.t.sol + test/SoulVaultTreasury.t.sol + test/SoulVaultFundRequest.t.sol).
 *
 * This file validates:
 *   - CLI ABI wiring matches the on-chain contract interface
 *   - Event parsing from receipts through CLI helpers (requestId extraction, etc.)
 *   - The merged swarm + treasury event watcher with (blockNumber, logIndex) ordering
 *   - Status filtering in listFundRequests
 *   - Error surfacing for insufficient balance, pause, invalid state
 *   - Local profile → contract address resolution
 *
 * Setup deploys one Swarm + one Treasury (account[0] = owner) and bootstraps
 * account[1] as an active member. Each test files its own fresh fund request so
 * tests don't couple to each other's state (except shared balance, which is topped
 * up enough to cover all tests).
 */
describe('fund request flow (CLI integration)', () => {
  let provider: JsonRpcProvider;
  let owner: Wallet; // account[0] — deploys swarm + treasury, also swarm owner, treasury owner
  let alice: Wallet; // account[1] — swarm member, fund requester

  // Raw ethers contract instances for setup + member-side calls (alice).
  let swarmRaw: Contract; // connected to alice for requestFunds / cancelFundRequest
  let swarmAsOwner: Contract; // connected to owner for approveJoin / setTreasury
  let swarmPauseCtl: Contract; // owner-bound with a minimal pause/unpause ABI (not in SOULVAULT_SWARM_ABI)
  let treasuryRaw: Contract; // connected to owner for raw setup (direct value transfer)

  let swarmAddress: string;
  let treasuryAddress: string;

  const ORG_SLUG = 'test-fund-org';
  const SWARM_SLUG = 'test-fund-swarm';

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (global-setup should populate it)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (global-setup should populate it)');

    provider = new JsonRpcProvider(rpcUrl);
    owner = new Wallet(privateKey, provider);

    // Derive a second local account for alice. Anvil / hardhat default mnemonic
    // "test test test test test test test test test test test junk" exposes the
    // first 10 accounts as pre-funded. Account[1]'s canonical private key:
    alice = new Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider,
    );

    // Make sure alice has a sizeable balance — ens-app-v3 anvil mint may or may not
    // have pre-funded her. Transfer 10 ether from owner if she's close to empty.
    const aliceBalance = await provider.getBalance(alice.address);
    if (aliceBalance < parseEther('5')) {
      const fundTx = await owner.sendTransaction({
        to: alice.address,
        value: parseEther('10'),
      });
      await fundTx.wait();
    }

    // 1. Deploy fresh SoulVaultTreasury first, then SoulVaultSwarm with the treasury address
    //    baked into the constructor — matches the new bootstrap order where swarms are
    //    born already bound to their treasury.
    const swarmArtifact = loadForgeArtifact('SoulVaultSwarm');
    const treasuryArtifact = loadForgeArtifact('SoulVaultTreasury');

    const treasuryContract = await deployContract(owner, treasuryArtifact);
    treasuryAddress = await treasuryContract.getAddress();

    const swarmContract = await deployContract(owner, swarmArtifact, [treasuryAddress]);
    swarmAddress = await swarmContract.getAddress();

    swarmAsOwner = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, owner);
    swarmRaw = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, alice);
    // pause() / unpause() aren't in the main CLI ABI (no CLI command uses them).
    // We create a minimal separate Contract instance for the pause test.
    swarmPauseCtl = new Contract(
      swarmAddress,
      ['function pause()', 'function unpause()', 'function paused() view returns (bool)'],
      owner,
    );
    treasuryRaw = new Contract(
      treasuryAddress,
      ['function balance() view returns (uint256)', 'function owner() view returns (address)'],
      provider,
    );

    // 2. Re-bind swarm -> treasury via setTreasury. The swarm was already born bound
    //    via the constructor above, so this is a no-op mutation of the storage slot to
    //    the same address — but it still exercises the owner-only re-setter path that
    //    older tests relied on, and verifies the post-construction binding flow keeps
    //    working for swarms that need to rotate or attach a treasury later.
    const setTreasuryTx = await swarmAsOwner.setTreasury(treasuryAddress);
    await setTreasuryTx.wait();

    // 3. Bootstrap alice as an active member (requestJoin + approveJoin)
    const joinTx = await swarmRaw.requestJoin('0x010203', 'pub:alice', 'meta:alice');
    const joinReceipt = await joinTx.wait();
    let joinRequestId: bigint | undefined;
    for (const log of joinReceipt?.logs ?? []) {
      try {
        const parsed = swarmRaw.interface.parseLog(log);
        if (parsed?.name === 'JoinRequested') {
          joinRequestId = parsed.args.requestId;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (joinRequestId === undefined) throw new Error('Failed to parse JoinRequested event from setup');
    const approveTx = await swarmAsOwner.approveJoin(joinRequestId);
    await approveTx.wait();

    // 4. Create local CLI profiles so the CLI lib functions can resolve the contracts.
    //    The integration harness isolates HOME to a temp dir (via global-setup), so these
    //    writes don't pollute the developer's real profile.
    await fs.ensureDir(resolveCliStateDir());

    await createOrganizationProfile({
      name: ORG_SLUG,
      visibility: 'private', // skip ENS — we exercise ENS text records separately
    });

    await createSwarmProfile({
      organization: ORG_SLUG,
      name: SWARM_SLUG,
      contractAddress: swarmAddress, // skip deployment since we already deployed
    });

    const treasuryProfile = buildTreasuryProfile({
      organization: ORG_SLUG,
      contractAddress: treasuryAddress,
      ownerAddress: owner.address,
    });
    await writeTreasuryProfile(treasuryProfile);

    // 5. Deposit 10 ether into the treasury via the CLI helper (validates depositToTreasury).
    await depositToTreasury({
      organization: ORG_SLUG,
      amountEther: '10',
    });
  }, 120_000);

  async function fileFundRequestAsAlice(amountEther: string, reason: string): Promise<string> {
    const tx = await swarmRaw.requestFunds(parseEther(amountEther), reason);
    const receipt = await tx.wait();
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = swarmRaw.interface.parseLog(log);
        if (parsed?.name === 'FundRequested') {
          return parsed.args.requestId.toString();
        }
      } catch {
        /* ignore */
      }
    }
    throw new Error('Failed to parse FundRequested event from fund-request tx');
  }

  it('treasury status reports correct balance after deposit', async () => {
    const status = await getTreasuryStatus({ organization: ORG_SLUG });
    expect(status.organization).toBe(ORG_SLUG);
    expect(status.contractAddress.toLowerCase()).toBe(treasuryAddress.toLowerCase());
    expect(status.owner.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(BigInt(status.balanceWei)).toBeGreaterThanOrEqual(parseEther('10'));
  });

  it('happy path: request → approve releases funds to the requester', async () => {
    // File the request first (alice pays gas), then snapshot AFTER so the delta
    // reflects only the approve tx, which is owner-signed (no gas cost to alice).
    const requestId = await fileFundRequestAsAlice('1', 'ops gas');
    const aliceBefore = await provider.getBalance(alice.address);

    // Sanity: CLI status read matches PENDING.
    const pending = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(pending.statusLabel).toBe('pending');
    expect(pending.amountWei).toBe(parseEther('1').toString());
    expect(pending.reason).toBe('ops gas');
    expect(pending.requester.toLowerCase()).toBe(alice.address.toLowerCase());

    // Approve via the CLI lib function — uses the env signer (owner), which matches
    // the treasury owner. Exercises the full ABI wiring and event parsing.
    const result = await approveFundRequestViaTreasury({
      organization: ORG_SLUG,
      swarm: SWARM_SLUG,
      requestId,
    });

    expect(result.swarmAddress.toLowerCase()).toBe(swarmAddress.toLowerCase());
    expect(result.requestId).toBe(requestId);
    expect(result.recipient?.toLowerCase()).toBe(alice.address.toLowerCase());
    expect(result.amountWei).toBe(parseEther('1').toString());

    // Alice's on-chain balance went up by exactly 1 ether — no gas cost because
    // the approve tx is owner-signed, and we snapshotted after alice's own
    // request tx already settled.
    const aliceAfter = await provider.getBalance(alice.address);
    expect(aliceAfter - aliceBefore).toBe(parseEther('1'));

    // CLI status read reflects APPROVED.
    const approved = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(approved.statusLabel).toBe('approved');
    expect(Number(approved.resolvedAt)).toBeGreaterThan(0);
  });

  it('reject path: does not move funds, status flips to rejected', async () => {
    // File the request FIRST (alice pays gas), then snapshot the "after-filing" balances.
    // The reject tx is owner-signed and should not touch alice's balance or treasury balance.
    const requestId = await fileFundRequestAsAlice('2', 'dev tools');
    const treasuryBefore = await treasuryRaw.balance();
    const aliceBefore = await provider.getBalance(alice.address);

    const result = await rejectFundRequestViaTreasury({
      organization: ORG_SLUG,
      swarm: SWARM_SLUG,
      requestId,
      reason: 'out of scope',
    });
    expect(result.requestId).toBe(requestId);
    expect(result.reason).toBe('out of scope');

    const rejected = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(rejected.statusLabel).toBe('rejected');

    // No funds moved: treasury balance unchanged, alice's balance unchanged
    // (the reject tx is paid for by the owner, not alice).
    expect(await treasuryRaw.balance()).toBe(treasuryBefore);
    expect(await provider.getBalance(alice.address)).toBe(aliceBefore);
  });

  it('cancel path: requester cancels, subsequent approve reverts', async () => {
    const requestId = await fileFundRequestAsAlice('1', 'maybe later');

    // Alice cancels via raw ethers (her signer)
    const cancelTx = await swarmRaw.cancelFundRequest(requestId);
    await cancelTx.wait();

    const cancelled = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(cancelled.statusLabel).toBe('cancelled');

    // Owner tries to approve a cancelled request — reverts. We catch the error
    // message (ethers v6 wraps reverts with custom error names in .shortMessage or
    // .info.error.data).
    await expect(
      approveFundRequestViaTreasury({
        organization: ORG_SLUG,
        swarm: SWARM_SLUG,
        requestId,
      }),
    ).rejects.toThrow();
  });

  it('insufficient balance: approve reverts, swarm-side status stays pending', async () => {
    const requestId = await fileFundRequestAsAlice('1000', 'too much');

    await expect(
      approveFundRequestViaTreasury({
        organization: ORG_SLUG,
        swarm: SWARM_SLUG,
        requestId,
      }),
    ).rejects.toThrow();

    // Atomic revert — swarm-side status stays PENDING
    const stillPending = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(stillPending.statusLabel).toBe('pending');

    // Cleanup: cancel so subsequent tests aren't distracted
    await swarmRaw.cancelFundRequest(requestId).then((tx: any) => tx.wait());
  });

  it('pause interaction: swarm paused blocks approve, no state change', async () => {
    const requestId = await fileFundRequestAsAlice('1', 'paused test');
    const treasuryBefore = await treasuryRaw.balance();

    const pauseTx = await swarmPauseCtl.pause();
    await pauseTx.wait();

    await expect(
      approveFundRequestViaTreasury({
        organization: ORG_SLUG,
        swarm: SWARM_SLUG,
        requestId,
      }),
    ).rejects.toThrow();

    // Nothing changed
    expect(await treasuryRaw.balance()).toBe(treasuryBefore);
    const stillPending = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(stillPending.statusLabel).toBe('pending');

    // Unpause and approve succeeds
    const unpauseTx = await swarmPauseCtl.unpause();
    await unpauseTx.wait();

    const approved = await approveFundRequestViaTreasury({
      organization: ORG_SLUG,
      swarm: SWARM_SLUG,
      requestId,
    });
    expect(approved.requestId).toBe(requestId);
  });

  it('listFundRequests filters by status correctly', async () => {
    // We've filed a bunch of requests across tests with different final states.
    // Pull them all and verify the status filter narrows correctly.
    const all = await listFundRequests({ swarm: SWARM_SLUG });
    const approved = await listFundRequests({ swarm: SWARM_SLUG, statusFilter: 'approved' });
    const rejected = await listFundRequests({ swarm: SWARM_SLUG, statusFilter: 'rejected' });
    const cancelled = await listFundRequests({ swarm: SWARM_SLUG, statusFilter: 'cancelled' });

    expect(all.requests.length).toBeGreaterThanOrEqual(5);
    expect(approved.requests.length).toBeGreaterThanOrEqual(2); // happy path + unpause-and-approve
    expect(rejected.requests.length).toBeGreaterThanOrEqual(1);
    expect(cancelled.requests.length).toBeGreaterThanOrEqual(2); // cancel path + insufficient-balance cleanup

    // Every entry in a filtered list has the expected status.
    for (const r of approved.requests) expect(r.statusLabel).toBe('approved');
    for (const r of rejected.requests) expect(r.statusLabel).toBe('rejected');
    for (const r of cancelled.requests) expect(r.statusLabel).toBe('cancelled');
  });

  it('event watcher merges swarm + treasury events with correct (block, logIndex) ordering', async () => {
    const batch = await listRecentSwarmEvents({ swarm: SWARM_SLUG });

    expect(batch.treasuryAddress?.toLowerCase()).toBe(treasuryAddress.toLowerCase());
    expect(batch.events.length).toBeGreaterThan(0);

    // Every event is tagged with its source.
    for (const e of batch.events) {
      expect(['swarm', 'treasury']).toContain((e as any).source);
    }

    // We should see both swarm-side fund events AND treasury-side events.
    const swarmEventTypes = new Set(
      batch.events.filter((e: any) => e.source === 'swarm').map((e: any) => e.type),
    );
    const treasuryEventTypes = new Set(
      batch.events.filter((e: any) => e.source === 'treasury').map((e: any) => e.type),
    );

    expect(swarmEventTypes.has('TreasurySet')).toBe(true);
    expect(swarmEventTypes.has('FundRequested')).toBe(true);
    expect(swarmEventTypes.has('FundRequestApproved')).toBe(true);
    expect(swarmEventTypes.has('FundRequestRejected')).toBe(true);
    expect(swarmEventTypes.has('FundRequestCancelled')).toBe(true);

    expect(treasuryEventTypes.has('FundsDeposited')).toBe(true);
    expect(treasuryEventTypes.has('FundsReleased')).toBe(true);
    expect(treasuryEventTypes.has('FundRequestRejectedByTreasury')).toBe(true);

    // Critical invariant: events must be sorted by (blockNumber, logIndex).
    // Within the same block, FundRequestApproved (swarm) MUST precede FundsReleased
    // (treasury) because that's their on-chain order in the same tx.
    for (let i = 1; i < batch.events.length; i++) {
      const prev = batch.events[i - 1] as any;
      const curr = batch.events[i] as any;
      if (prev.blockNumber === curr.blockNumber) {
        expect(prev.logIndex).toBeLessThanOrEqual(curr.logIndex);
      } else {
        expect(prev.blockNumber).toBeLessThan(curr.blockNumber);
      }
    }

    // Pair check: for every FundRequestApproved, the next event (same tx) should be
    // FundsReleased with matching requestId.
    for (let i = 0; i < batch.events.length - 1; i++) {
      const curr = batch.events[i] as any;
      if (curr.type !== 'FundRequestApproved') continue;
      const next = batch.events[i + 1] as any;
      if (curr.txHash === next.txHash) {
        expect(next.type).toBe('FundsReleased');
        expect(next.requestId).toBe(curr.requestId);
      }
    }
  });

  it('treasury status reflects spending over the test run', async () => {
    // We deposited 10 ether, then spent at least 1 (happy path) + 1 (pause test) = 2 ether.
    // Insufficient / rejected / cancelled requests don't spend.
    const status = await getTreasuryStatus({ organization: ORG_SLUG });
    const spent = parseEther('10') - BigInt(status.balanceWei);
    expect(spent).toBeGreaterThanOrEqual(parseEther('2'));
    expect(spent).toBeLessThanOrEqual(parseEther('10'));
    // Sanity: balance is a reasonable number, not borked
    expect(Number(formatEther(status.balanceWei))).toBeGreaterThanOrEqual(0);
  });
});
