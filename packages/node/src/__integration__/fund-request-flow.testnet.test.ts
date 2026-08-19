import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import { SOULVAULT_SWARM_ABI } from '../swarm-contract.js';

/**
 * Gated testnet smoke test for feat/agent-request-funds.
 *
 * Deploys FRESH SoulVaultSwarm + SoulVaultTreasury to whatever `SOULVAULT_RPC_URL`
 * points at (real 0G Galileo in the intended setup), runs one happy-path round-trip
 * with a small amount, and logs addresses for manual inspection. Does NOT clean up
 * the deployed contracts — they're throwaway.
 *
 * Skipped by default. Enable with:
 *   SOULVAULT_TESTNET_INTEGRATION=1 pnpm test:testnet
 *
 * Requires a funded `SOULVAULT_PRIVATE_KEY` on the target chain. The test uses
 * 0.01 native token for the round-trip, plus gas.
 *
 * This test intentionally sidesteps ens-app-v3 and the local harness's chain probe
 * (the global-setup checks reachability; a real testnet RPC will respond normally).
 * It does NOT exercise the ENS text record write path — that requires a real
 * registered org ENS name on Sepolia and is a separate manual story-level check.
 */
const testnetEnabled = process.env.SOULVAULT_TESTNET_INTEGRATION === '1';

describe.skipIf(!testnetEnabled)('fund request flow (testnet smoke)', () => {
  let provider: JsonRpcProvider;
  let owner: Wallet;

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set');

    provider = new JsonRpcProvider(rpcUrl);
    owner = new Wallet(privateKey, provider);

    const balance = await provider.getBalance(owner.address);
    if (balance < parseEther('0.05')) {
      throw new Error(
        `Testnet signer ${owner.address} has insufficient balance (${balance} wei). ` +
          `Fund it with at least 0.05 native token before running pnpm test:testnet.`,
      );
    }
  }, 60_000);

  it('deploys fresh contracts and completes one request/approve round-trip', async () => {
    const swarmArtifact = loadForgeArtifact('SoulVaultSwarm');
    const treasuryArtifact = loadForgeArtifact('SoulVaultTreasury');

    // eslint-disable-next-line no-console
    console.log(`[testnet] Deploying SoulVaultSwarm + SoulVaultTreasury from ${owner.address}...`);

    const swarmContract = await deployContract(owner, swarmArtifact);
    const treasuryContract = await deployContract(owner, treasuryArtifact);

    const swarmAddress = await swarmContract.getAddress();
    const treasuryAddress = await treasuryContract.getAddress();

    // eslint-disable-next-line no-console
    console.log(`[testnet] SoulVaultSwarm @ ${swarmAddress}`);
    // eslint-disable-next-line no-console
    console.log(`[testnet] SoulVaultTreasury @ ${treasuryAddress}`);

    const swarm = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, owner);

    // Wire + self-member. Owner is deployer; owner is also the member (single-operator
    // testnet smoke — simplest possible path to exercise the full flow).
    const setTreasuryTx = await swarm.setTreasury(treasuryAddress);
    await setTreasuryTx.wait();

    const joinTx = await swarm.requestJoin('0xDEADBEEF', 'pub:owner', 'meta:owner');
    const joinReceipt = await joinTx.wait();
    let joinRequestId: bigint | undefined;
    for (const log of joinReceipt?.logs ?? []) {
      try {
        const parsed = swarm.interface.parseLog(log);
        if (parsed?.name === 'JoinRequested') {
          joinRequestId = parsed.args.requestId;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (joinRequestId === undefined) throw new Error('Failed to parse JoinRequested event');

    const approveJoinTx = await swarm.approveJoin(joinRequestId);
    await approveJoinTx.wait();

    // Deposit 0.02 to cover the 0.01 request + slack.
    const depositTx = await owner.sendTransaction({
      to: treasuryAddress,
      value: parseEther('0.02'),
    });
    await depositTx.wait();

    // File and approve a fund request.
    const requestTx = await swarm.requestFunds(parseEther('0.01'), 'testnet smoke');
    const requestReceipt = await requestTx.wait();
    let fundRequestId: bigint | undefined;
    for (const log of requestReceipt?.logs ?? []) {
      try {
        const parsed = swarm.interface.parseLog(log);
        if (parsed?.name === 'FundRequested') {
          fundRequestId = parsed.args.requestId;
          break;
        }
      } catch {
        /* ignore */
      }
    }
    if (fundRequestId === undefined) throw new Error('Failed to parse FundRequested event');

    const treasury = new Contract(
      treasuryAddress,
      ['function approveFundRequest(address swarm, uint256 requestId)'],
      owner,
    );
    const approveTx = await treasury.approveFundRequest(swarmAddress, fundRequestId);
    const approveReceipt = await approveTx.wait();

    expect(approveReceipt?.status).toBe(1);

    // eslint-disable-next-line no-console
    console.log(`[testnet] OK — round-trip complete.`);
    // eslint-disable-next-line no-console
    console.log(`[testnet] Deploy tx:    ${swarmContract.deploymentTransaction()?.hash}`);
    // eslint-disable-next-line no-console
    console.log(`[testnet] Request tx:   ${requestTx.hash}`);
    // eslint-disable-next-line no-console
    console.log(`[testnet] Approve tx:   ${approveTx.hash}`);
  }, 300_000);
});
