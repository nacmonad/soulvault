/**
 * Story 02 — ERC-8004 agent registration via raw tx signing.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { loadForgeArtifact, deployContract } from '../../../test/helpers/forge-artifacts.js';
import {
  setupFundedEnv,
  walkAndCaptureDevice,
  resetDeviceToHome,
} from '../../../test/speculos/suite-helpers.js';
import { createSigner, signTransactionWithMode, type SoulVaultSigner } from '../signer.js';

describe('story02 — ERC-8004 register [hardware]', () => {
  let provider: JsonRpcProvider;
  let funder: Wallet;
  let owner: SoulVaultSigner;
  let ownerAddr: string;
  let registry: Contract;

  beforeAll(async () => {
    owner = await createSigner();
    ownerAddr = await owner.getAddress();
    const env = await setupFundedEnv({ ownerAddress: ownerAddr });
    provider = env.provider;
    funder = env.funder;
    registry = (await deployContract(funder, loadForgeArtifact('SoulVaultERC8004RegistryAdapter'), [])) as unknown as Contract;
  }, 300_000);

  afterEach(async () => { await resetDeviceToHome(); });

  it('owner signs registerAgent (raw tx, clear-sign preferred → blind)', async () => {
    const data = registry.interface.encodeFunctionData('registerAgent', [ownerAddr, 'ipfs://manifest']);
    const toAddr = await registry.getAddress();
    const nonce = await provider.getTransactionCount(ownerAddr, 'latest');
    const net = await provider.getNetwork();
    const fee = await provider.getFeeData();
    const tx = {
      to: toAddr,
      data,
      value: 0n,
      chainId: net.chainId,
      nonce,
      gasLimit: 300_000n,
      gasPrice: fee.gasPrice ?? 1_000_000_000n,
    };
    const signedP = signTransactionWithMode(owner, tx, { clearSign: 'clear-sign-preferred' });
    await walkAndCaptureDevice(signedP, 'registerAgent');
    const signed = await signedP;
    expect(signed).toMatch(/^0x/);
  }, 180_000);
});
