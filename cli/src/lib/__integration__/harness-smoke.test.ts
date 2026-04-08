import { describe, it, expect, beforeAll } from 'vitest';
import { JsonRpcProvider, Wallet, ZeroAddress, type Contract } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';

/**
 * Smoke test for the integration harness (Lane B of feat/agent-request-funds).
 *
 * If this passes, the harness is wired correctly:
 *   - globalSetup loaded .env.test
 *   - `forge build` ran and out/ is populated
 *   - The local chain (ens-app-v3 / anvil) is reachable
 *   - Foundry artifacts load and deploy via ethers ContractFactory
 *   - SoulVaultSwarm + SoulVaultTreasury wire together correctly
 *
 * This does NOT exercise the full fund-request flow — that's Lane D.
 */
describe('integration harness smoke', () => {
  let provider: JsonRpcProvider;
  let deployer: Wallet;
  let swarm: Contract;
  let treasury: Contract;

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (should be populated by globalSetup from .env.test)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (should be populated by globalSetup from .env.test)');

    provider = new JsonRpcProvider(rpcUrl);
    deployer = new Wallet(privateKey, provider);

    const swarmArtifact = loadForgeArtifact('SoulVaultSwarm');
    const treasuryArtifact = loadForgeArtifact('SoulVaultTreasury');

    // SoulVaultSwarm's constructor now takes `address initialTreasury`. Pass
    // ZeroAddress here since the smoke test exercises the post-construction
    // `setTreasury` path anyway.
    swarm = await deployContract(deployer, swarmArtifact, [ZeroAddress]);
    treasury = await deployContract(deployer, treasuryArtifact);
  });

  it('loads forge artifacts and deploys SoulVaultSwarm', async () => {
    const swarmAddress = await swarm.getAddress();
    expect(swarmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const ownerAddress = await swarm.owner();
    expect(ownerAddress.toLowerCase()).toBe(deployer.address.toLowerCase());
  });

  it('deploys SoulVaultTreasury and reads owner', async () => {
    const treasuryAddress = await treasury.getAddress();
    expect(treasuryAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const ownerAddress = await treasury.owner();
    expect(ownerAddress.toLowerCase()).toBe(deployer.address.toLowerCase());

    const balance = await treasury.balance();
    expect(balance).toBe(0n);
  });

  it('wires swarm -> treasury via setTreasury and reads back', async () => {
    const treasuryAddress = await treasury.getAddress();
    const tx = await swarm.setTreasury(treasuryAddress);
    await tx.wait();

    const bound = await swarm.treasury();
    expect(bound.toLowerCase()).toBe(treasuryAddress.toLowerCase());
  });

  it('receives native value via receive() and updates balance', async () => {
    const treasuryAddress = await treasury.getAddress();
    const tx = await deployer.sendTransaction({
      to: treasuryAddress,
      value: 1_000_000_000_000_000n, // 0.001 ether
    });
    await tx.wait();

    const balance = await treasury.balance();
    expect(balance).toBe(1_000_000_000_000_000n);
  });
});
