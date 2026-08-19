import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import fs from 'fs-extra';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import { createSigner, type SoulVaultSigner } from '../signer.js';
import { createOrganizationProfile } from '../organization.js';
import { createSwarmProfile } from '../swarm.js';
import { buildTreasuryProfile, writeTreasuryProfile } from '../treasury.js';
import {
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
 * Hardware Ledger signer — subset of fund-request integration coverage.
 *
 * Loaded env: `.env.ledger.test` (via `global-setup-ledger.ts`).
 * Expect several on-device transaction approvals during `beforeAll` alone.
 *
 * Exhaustive edge cases stay in `fund-request-flow.integration.test.ts` (private-key).
 *
 * Run from `cli/`: `pnpm test:ledger`
 */
describe('fund request flow (Ledger integration)', () => {
  let provider: JsonRpcProvider;
  let funder: Wallet;
  let owner: SoulVaultSigner;
  let alice: Wallet;

  let swarmRaw: Contract;
  let swarmAsOwner: Contract;
  let treasuryRaw: Contract;

  let swarmAddress: string;
  let treasuryAddress: string;

  const ORG_SLUG = 'test-ledger-fund-org';
  const SWARM_SLUG = 'test-ledger-fund-swarm';

  function expectedLedgerAddress(): string {
    const raw = process.env.SOULVAULT_LEDGER_TEST_ADDRESS?.trim();
    if (!raw) throw new Error('SOULVAULT_LEDGER_TEST_ADDRESS must be set in .env.ledger.test');
    return raw.toLowerCase();
  }

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const funderPk = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set');
    if (!funderPk) throw new Error('SOULVAULT_PRIVATE_KEY not set (funder key in .env.ledger.test)');

    provider = new JsonRpcProvider(rpcUrl);
    funder = new Wallet(funderPk, provider);

    const ledgerAddr = expectedLedgerAddress();
    const minLedger = parseEther('25');
    let ledgerBal = await provider.getBalance(ledgerAddr);
    if (ledgerBal < minLedger) {
      const tx = await funder.sendTransaction({
        to: ledgerAddr,
        value: parseEther('40'),
      });
      await tx.wait();
      ledgerBal = await provider.getBalance(ledgerAddr);
    }
    expect(ledgerBal).toBeGreaterThanOrEqual(minLedger);

    owner = await createSigner();
    const resolved = (await owner.getAddress()).toLowerCase();
    expect(resolved).toBe(ledgerAddr);

    alice = new Wallet(
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      provider,
    );

    const aliceBalance = await provider.getBalance(alice.address);
    if (aliceBalance < parseEther('5')) {
      const fundTx = await funder.sendTransaction({
        to: alice.address,
        value: parseEther('10'),
      });
      await fundTx.wait();
    }

    const swarmArtifact = loadForgeArtifact('SoulVaultSwarm');
    const treasuryArtifact = loadForgeArtifact('SoulVaultTreasury');

    const swarmContract = await deployContract(owner, swarmArtifact);
    const treasuryContract = await deployContract(owner, treasuryArtifact);

    swarmAddress = await swarmContract.getAddress();
    treasuryAddress = await treasuryContract.getAddress();

    swarmAsOwner = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, owner);
    swarmRaw = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, alice);
    treasuryRaw = new Contract(
      treasuryAddress,
      ['function balance() view returns (uint256)', 'function owner() view returns (address)'],
      provider,
    );

    const setTreasuryTx = await swarmAsOwner.setTreasury(treasuryAddress);
    await setTreasuryTx.wait();

    const joinTx = await swarmRaw.requestJoin('0x010203', 'pub:alice-ledger', 'meta:alice-ledger');
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

    await fs.ensureDir(resolveCliStateDir());

    await createOrganizationProfile({
      name: ORG_SLUG,
      visibility: 'private',
    });

    await createSwarmProfile({
      organization: ORG_SLUG,
      name: SWARM_SLUG,
      contractAddress: swarmAddress,
    });

    const treasuryProfile = buildTreasuryProfile({
      organization: ORG_SLUG,
      contractAddress: treasuryAddress,
      ownerAddress: await owner.getAddress(),
    });
    await writeTreasuryProfile(treasuryProfile);

    await depositToTreasury({
      organization: ORG_SLUG,
      amountEther: '10',
    });
  }, 600_000);

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

  it('treasury status after Ledger-signed deposit', async () => {
    const status = await getTreasuryStatus({ organization: ORG_SLUG });
    expect(status.organization).toBe(ORG_SLUG);
    expect(status.contractAddress.toLowerCase()).toBe(treasuryAddress.toLowerCase());
    expect(status.owner.toLowerCase()).toBe(expectedLedgerAddress());
    expect(BigInt(status.balanceWei)).toBeGreaterThanOrEqual(parseEther('10'));
  });

  it('happy path: approve via treasury (Ledger signs)', async () => {
    const requestId = await fileFundRequestAsAlice('1', 'ledger happy');
    const aliceBefore = await provider.getBalance(alice.address);

    const pending = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(pending.statusLabel).toBe('pending');

    const result = await approveFundRequestViaTreasury({
      organization: ORG_SLUG,
      swarm: SWARM_SLUG,
      requestId,
    });

    expect(result.swarmAddress.toLowerCase()).toBe(swarmAddress.toLowerCase());
    expect(result.requestId).toBe(requestId);
    expect(result.recipient?.toLowerCase()).toBe(alice.address.toLowerCase());

    const aliceAfter = await provider.getBalance(alice.address);
    expect(aliceAfter - aliceBefore).toBe(parseEther('1'));

    const approved = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(approved.statusLabel).toBe('approved');
  });

  it('reject path: Ledger-signed reject', async () => {
    const requestId = await fileFundRequestAsAlice('2', 'ledger reject');
    const treasuryBefore = await treasuryRaw.balance();
    const aliceBefore = await provider.getBalance(alice.address);

    const result = await rejectFundRequestViaTreasury({
      organization: ORG_SLUG,
      swarm: SWARM_SLUG,
      requestId,
      reason: 'ledger test reject',
    });
    expect(result.requestId).toBe(requestId);

    const rejected = await getFundRequestStatus({ swarm: SWARM_SLUG, requestId });
    expect(rejected.statusLabel).toBe('rejected');

    expect(await treasuryRaw.balance()).toBe(treasuryBefore);
    expect(await provider.getBalance(alice.address)).toBe(aliceBefore);
  });

  it('treasury balance reflects payouts', async () => {
    const status = await getTreasuryStatus({ organization: ORG_SLUG });
    const spent = parseEther('10') - BigInt(status.balanceWei);
    expect(spent).toBeGreaterThanOrEqual(parseEther('1'));
    expect(spent).toBeLessThanOrEqual(parseEther('10'));
    expect(Number(formatEther(status.balanceWei))).toBeGreaterThanOrEqual(0);
  });
});
