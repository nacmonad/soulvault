import { describe, it, expect } from 'vitest';
import { namehash } from 'viem/ens';
import {
  setOrganizationMetadataEnsRecords,
  bindOrganizationEnsTextRecords,
} from '../organization-deploy.js';
import { readEnsText, readEnsNodeOwner } from '../ens.js';

/**
 * ENS text record integration tests.
 *
 * global-setup already registered soulvault.eth, deployed the org contract,
 * and wrote all mandatory + ERC-4824 text records. Tests here:
 *   1. Verify the records written by global-setup
 *   2. Test patching via setOrganizationMetadataEnsRecords
 *   3. Test error paths (unregistered names, missing fields)
 */
describe('organization ENS text records (CLI integration)', () => {
  const ENS_NAME = process.env.TEST_ENS_NAME!;
  const orgAddress = process.env.TEST_ORG_ADDRESS!;
  const chainId = process.env.SOULVAULT_CHAIN_ID!;

  // ---- Verify records written by global-setup ----

  it('soulvault.eth is owned by Account[0]', async () => {
    const result = await readEnsNodeOwner(ENS_NAME);
    const ownerAddr = process.env.SOULVAULT_PRIVATE_KEY
      ? '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
      : '';
    expect(result.owner.toLowerCase()).toBe(ownerAddr.toLowerCase());
    expect(result.node).toBe(namehash(ENS_NAME));
  });

  it('mandatory orgContract + orgChainId records are set', async () => {
    const contract = await readEnsText(ENS_NAME, 'soulvault.orgContract');
    const chain = await readEnsText(ENS_NAME, 'soulvault.orgChainId');
    expect(contract.toLowerCase()).toBe(orgAddress.toLowerCase());
    expect(chain).toBe(chainId);
  });

  it('all ERC-4824 fields are set by global-setup', async () => {
    expect(await readEnsText(ENS_NAME, 'daoURI')).toBe(process.env.TEST_ERC4824_DAO_URI);
    expect(await readEnsText(ENS_NAME, 'soulvault.membersURI')).toBe(process.env.TEST_ERC4824_MEMBERS_URI);
    expect(await readEnsText(ENS_NAME, 'soulvault.governanceURI')).toBe(process.env.TEST_ERC4824_GOVERNANCE_URI);
    expect(await readEnsText(ENS_NAME, 'soulvault.contractsURI')).toBe(process.env.TEST_ERC4824_CONTRACTS_URI);
  });

  // ---- Test patching ----

  it('setOrganizationMetadataEnsRecords patches only supplied fields', async () => {
    const result = await setOrganizationMetadataEnsRecords({
      organizationEnsName: ENS_NAME,
      governanceURI: 'ipfs://QmGovernanceV2',
    });

    expect(result.governanceURITextTxHash).toBeTruthy();
    expect(result.daoURITextTxHash).toBeUndefined();

    expect(await readEnsText(ENS_NAME, 'soulvault.governanceURI')).toBe('ipfs://QmGovernanceV2');
    // Unpatched fields unchanged
    expect(await readEnsText(ENS_NAME, 'daoURI')).toBe(process.env.TEST_ERC4824_DAO_URI);
    expect(await readEnsText(ENS_NAME, 'soulvault.membersURI')).toBe(process.env.TEST_ERC4824_MEMBERS_URI);
  });

  it('bindOrganizationEnsTextRecords overwrites mandatory + subset of optional', async () => {
    const result = await bindOrganizationEnsTextRecords({
      organizationEnsName: ENS_NAME,
      contractAddress: orgAddress,
      daoURI: 'https://soulvault.example/dao-v2.json',
    });

    expect(result.contractTextTxHash).toBeTruthy();
    expect(result.chainIdTextTxHash).toBeTruthy();
    expect(result.daoURITextTxHash).toBeTruthy();
    expect(result.membersURITextTxHash).toBeUndefined();

    expect(await readEnsText(ENS_NAME, 'daoURI')).toBe('https://soulvault.example/dao-v2.json');
    expect(await readEnsText(ENS_NAME, 'soulvault.orgContract')).toBeTruthy();
  });

  // ---- Error paths ----

  it('setOrganizationMetadataEnsRecords throws when no fields provided', async () => {
    await expect(
      setOrganizationMetadataEnsRecords({ organizationEnsName: ENS_NAME }),
    ).rejects.toThrow('At least one of');
  });

  it('bindOrganizationEnsTextRecords throws for unregistered ENS name', async () => {
    await expect(
      bindOrganizationEnsTextRecords({
        organizationEnsName: 'nonexistent.eth',
        contractAddress: orgAddress,
      }),
    ).rejects.toThrow('not registered');
  });

  it('setOrganizationMetadataEnsRecords throws for unregistered ENS name', async () => {
    await expect(
      setOrganizationMetadataEnsRecords({
        organizationEnsName: 'nonexistent.eth',
        daoURI: 'https://example.com',
      }),
    ).rejects.toThrow('not registered');
  });
});
