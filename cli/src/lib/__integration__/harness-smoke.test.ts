import { describe, it, expect, beforeAll } from 'vitest';
import { JsonRpcProvider, Wallet, type Contract } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';

/**
 * Smoke test for the integration harness (Lane B of feat/agent-request-funds).
 *
 * If this passes, the harness is wired correctly:
 *   - globalSetup loaded .env.test
 *   - `forge build` ran and out/ is populated
 *   - The local chain (ens-app-v3 / anvil) is reachable
 *   - Foundry artifacts load and deploy via ethers ContractFactory
 *   - SoulVaultSwarm + SoulVaultOrganization wire together correctly
 *
 * This does NOT exercise the full fund-request flow — that's Lane D.
 */
describe('integration harness smoke', () => {
  let provider: JsonRpcProvider;
  let deployer: Wallet;
  let swarm: Contract;
  let organization: Contract;

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (should be populated by globalSetup from .env.test)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (should be populated by globalSetup from .env.test)');

    provider = new JsonRpcProvider(rpcUrl);
    deployer = new Wallet(privateKey, provider);

    const swarmArtifact = loadForgeArtifact('SoulVaultSwarm');
    const organizationArtifact = loadForgeArtifact('SoulVaultOrganization');

    swarm = await deployContract(deployer, swarmArtifact);
    organization = await deployContract(deployer, organizationArtifact);
  });

  it('loads forge artifacts and deploys SoulVaultSwarm', async () => {
    const swarmAddress = await swarm.getAddress();
    expect(swarmAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const ownerAddress = await swarm.owner();
    expect(ownerAddress.toLowerCase()).toBe(deployer.address.toLowerCase());
  });

  it('deploys SoulVaultOrganization and reads owner', async () => {
    const organizationAddress = await organization.getAddress();
    expect(organizationAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);

    const ownerAddress = await organization.owner();
    expect(ownerAddress.toLowerCase()).toBe(deployer.address.toLowerCase());

    const balance = await organization.balance();
    expect(balance).toBe(0n);
  });

  it('wires swarm -> organization via setOrganization and reads back', async () => {
    const organizationAddress = await organization.getAddress();
    const swarmAddress = await swarm.getAddress();
    const regTx = await organization.registerSwarm(swarmAddress);
    await regTx.wait();

    const tx = await swarm.setOrganization(organizationAddress);
    await tx.wait();

    const bound = await swarm.organization();
    expect(bound.toLowerCase()).toBe(organizationAddress.toLowerCase());
  });

  it('receives native value via receive() and updates balance', async () => {
    const organizationAddress = await organization.getAddress();
    const tx = await deployer.sendTransaction({
      to: organizationAddress,
      value: 1_000_000_000_000_000n, // 0.001 ether
    });
    await tx.wait();

    const balance = await organization.balance();
    expect(balance).toBe(1_000_000_000_000_000n);
  });
});
