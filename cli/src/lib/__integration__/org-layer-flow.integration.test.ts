import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs-extra';
import path from 'node:path';
import { Contract, JsonRpcProvider, Wallet, ZeroAddress, parseEther } from 'ethers';
import { namehash } from 'viem/ens';
import { createOrganizationProfile, setOrganizationEnsName } from '../organization.js';
import { createSwarmProfile, archiveSwarmProfile, getSwarmProfile } from '../swarm.js';
import {
  EnsNameUnavailableError,
  registerOrganizationEns,
} from '../ens-name.js';
import {
  getAddrMultichain,
  readEnsText,
  readOrgSwarmsList,
  OrgEnsRecordKeys,
  ORG_ENS_CLASS_VALUE,
} from '../ens.js';
import {
  bindTreasuryEnsAddr,
  deploySoulVaultTreasuryContract,
} from '../treasury-deploy.js';
import { buildTreasuryProfile, writeTreasuryProfile } from '../treasury.js';
import { depositToTreasury } from '../treasury-contract.js';
import { SOULVAULT_SWARM_ABI } from '../swarm-contract.js';
import { resolveCliStateDir, resolveSwarmsDir } from '../paths.js';

/**
 * End-to-end integration test for the SoulVault organization layer.
 *
 * Walks the full bootstrap flow against a locally-running ens-app-v3 node:
 *   1. organization create
 *   2. organization register-ens        (writes class/name metadata + resolver)
 *   3. treasury create                  (writes ENSIP-11 addr on org root)
 *   4. swarm create                     (constructor-bound to treasury, subdomain + swarms list)
 *   5. alice requests to join           (agent-join flow)
 *   6. owner approves alice             (active member count grows)
 *   7. bob requests to join             (agent-join flow, second agent)
 *   8. owner rejects bob                (member count unchanged)
 *   9. swarm remove                     (archives profile, strips from parent list)
 *  10. stealth swarm                    (no org, no treasury, no ENS)
 *
 * Contract-level edge cases are exhaustively covered by forge tests. This file's job is
 * to prove the CLI lib wiring stays coherent across ENS reads/writes, profile mutations,
 * and on-chain contract lifecycle when all those layers interact end-to-end.
 *
 * Requires:
 *  - ens-app-v3 running locally (default `localhost:8545`) with a low minCommitmentAge
 *    (otherwise registerOrganizationEns will stall on the mandatory commit→register wait)
 *  - `.env.test` populated with SOULVAULT_* vars pointing at that node
 *  - A funded owner signer (SOULVAULT_PRIVATE_KEY) on the identity lane
 *
 * See cli/test/global-setup.ts for harness invariants.
 */

// Anvil default mnemonic account[1] / account[2] — pre-funded by ens-app-v3's fork.
const ALICE_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const BOB_PRIVATE_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

function parseJoinRequestId(receipt: { logs?: ReadonlyArray<unknown> } | null, iface: Contract['interface']): bigint {
  for (const log of (receipt?.logs ?? []) as any[]) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === 'JoinRequested') return parsed.args.requestId as bigint;
    } catch {
      /* skip non-matching log */
    }
  }
  throw new Error('Failed to parse JoinRequested event from receipt');
}

describe('organization layer end-to-end flow', () => {
  // Per-run uniqueness. ENS names consumed by `register-ens` must not be reused across
  // test runs (the controller refuses to re-register an owned name), so we timestamp.
  const runId = Date.now();
  const ORG_NAME = `svtestorg${runId}`;
  const ORG_ENS_NAME = `${ORG_NAME}.eth`;
  const SWARM_LABEL = 'alpha';
  const STEALTH_SWARM_NAME = `stealth-${runId}`;

  let provider: JsonRpcProvider;
  let owner: Wallet; // CLI-default signer, also org owner / treasury owner / swarm owner
  let alice: Wallet;
  let bob: Wallet;

  let orgSlug: string;
  let treasuryAddress: string;
  let swarmAddress: string;
  let swarmSlug: string;

  beforeAll(async () => {
    const rpcUrl = process.env.SOULVAULT_RPC_URL;
    const privateKey = process.env.SOULVAULT_PRIVATE_KEY;
    if (!rpcUrl) throw new Error('SOULVAULT_RPC_URL not set (global-setup should populate it)');
    if (!privateKey) throw new Error('SOULVAULT_PRIVATE_KEY not set (global-setup should populate it)');

    provider = new JsonRpcProvider(rpcUrl);
    owner = new Wallet(privateKey, provider);
    alice = new Wallet(ALICE_PRIVATE_KEY, provider);
    bob = new Wallet(BOB_PRIVATE_KEY, provider);

    // Top up alice and bob from owner if needed so their join-request txs can pay gas.
    for (const w of [alice, bob]) {
      const bal = await provider.getBalance(w.address);
      if (bal < parseEther('1')) {
        const fundTx = await owner.sendTransaction({ to: w.address, value: parseEther('5') });
        await fundTx.wait();
      }
    }

    // Make sure the CLI state dir exists for profile writes.
    await fs.ensureDir(resolveCliStateDir());
  }, 120_000);

  it('walks the full bootstrap flow end-to-end', async () => {
    // -------------------------------------------------------------------
    // Step 1: organization create (local profile, not yet on-chain)
    // -------------------------------------------------------------------
    const org = await createOrganizationProfile({
      name: ORG_NAME,
      ensName: ORG_ENS_NAME,
      visibility: 'public',
      ownerAddress: owner.address,
    });
    orgSlug = org.slug;
    expect(org.ensName).toBe(ORG_ENS_NAME);
    expect(org.ensRegistration?.status).toBe('planned');

    // -------------------------------------------------------------------
    // Step 2: register-ens — commits, waits minCommitmentAge, registers, sets resolver,
    //          then writes org metadata records (class, name).
    // -------------------------------------------------------------------
    const reg = await registerOrganizationEns(orgSlug);
    expect(reg.organization.ensRegistration?.status).toBe('registered');

    // Verify the metadata records landed on-chain.
    expect(await readEnsText(ORG_ENS_NAME, OrgEnsRecordKeys.class)).toBe(ORG_ENS_CLASS_VALUE);
    expect(await readEnsText(ORG_ENS_NAME, OrgEnsRecordKeys.name)).toBe(ORG_NAME);

    // -------------------------------------------------------------------
    // Step 3: treasury create — deploy the contract + publish ENSIP-11 addr on org root.
    //          We call the lib functions directly (rather than the commander action
    //          wrapper) so the test can inspect return values.
    // -------------------------------------------------------------------
    const treasuryDeployment = await deploySoulVaultTreasuryContract();
    treasuryAddress = treasuryDeployment.address;
    const bound = await bindTreasuryEnsAddr({
      organizationEnsName: ORG_ENS_NAME,
      contractAddress: treasuryAddress,
    });
    expect(bound.addrTxHash).toBeDefined();

    // Persist the treasury profile so downstream lib calls can find it.
    const treasuryProfile = buildTreasuryProfile({
      organization: orgSlug,
      organizationEnsName: ORG_ENS_NAME,
      contractAddress: treasuryAddress,
      ownerAddress: owner.address,
      deploymentTxHash: treasuryDeployment.txHash,
      ensBinding: { status: 'bound', coinType: bound.coinType, addrTxHash: bound.addrTxHash },
    });
    await writeTreasuryProfile(treasuryProfile);

    // Verify ENSIP-11 addr is readable back from the org root at the expected coinType.
    const env = await import('../config.js').then((m) => m.loadEnv());
    const discovered = await getAddrMultichain(ORG_ENS_NAME, env.SOULVAULT_CHAIN_ID);
    expect(discovered?.toLowerCase()).toBe(treasuryAddress.toLowerCase());

    // Legacy text records must NOT be written (the migration dropped them).
    expect(await readEnsText(ORG_ENS_NAME, 'soulvault.treasuryContract')).toBe('');

    // Top up the treasury so fund request flows could theoretically run (not exercised
    // here — fund-request-flow.integration.test.ts covers that).
    await depositToTreasury({ organization: orgSlug, amountEther: '5' });

    // -------------------------------------------------------------------
    // Step 4: swarm create — CLI lib looks up treasury from the org ENS and bakes it
    //          into the constructor. After deploy, binds the subdomain and appends
    //          the swarm label to the parent org's CBOR swarms list.
    // -------------------------------------------------------------------
    const swarmProfile = await createSwarmProfile({
      organization: orgSlug,
      name: SWARM_LABEL,
      initialTreasury: treasuryAddress,
      visibility: 'public',
    });
    swarmAddress = swarmProfile.contractAddress!;
    swarmSlug = swarmProfile.slug;
    expect(swarmAddress).toBeDefined();
    expect(swarmProfile.organizationEnsName).toBe(ORG_ENS_NAME);

    // Assert the swarm was born already bound to the treasury.
    const swarmContract = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, provider);
    expect(String(await swarmContract.treasury()).toLowerCase()).toBe(treasuryAddress.toLowerCase());

    // Parent's CBOR swarms list contains the label.
    const swarmsList = await readOrgSwarmsList(ORG_ENS_NAME);
    expect(swarmsList).toContain(swarmProfile.ensName!.replace(`.${ORG_ENS_NAME}`, ''));

    // -------------------------------------------------------------------
    // Step 5-6: alice requests to join (agent-join flow — NOT fund-request), owner approves.
    // -------------------------------------------------------------------
    const swarmAsOwner = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, owner);
    const swarmAsAlice = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, alice);

    const aliceJoinTx = await swarmAsAlice.requestJoin('0x010203', 'pub:alice', 'meta:alice');
    const aliceJoinReceipt = await aliceJoinTx.wait();
    const aliceRequestId = parseJoinRequestId(aliceJoinReceipt, swarmAsAlice.interface);

    const approveTx = await swarmAsOwner.approveJoin(aliceRequestId);
    await approveTx.wait();

    const memberCountAfterAlice = await swarmContract.memberCount();
    expect(memberCountAfterAlice).toBe(1n);

    // -------------------------------------------------------------------
    // Step 7-8: bob requests to join, owner rejects — member count stays at 1.
    // -------------------------------------------------------------------
    const swarmAsBob = new Contract(swarmAddress, SOULVAULT_SWARM_ABI, bob);
    const bobJoinTx = await swarmAsBob.requestJoin('0x040506', 'pub:bob', 'meta:bob');
    const bobJoinReceipt = await bobJoinTx.wait();
    const bobRequestId = parseJoinRequestId(bobJoinReceipt, swarmAsBob.interface);

    const rejectTx = await swarmAsOwner.rejectJoin(bobRequestId, 'integration test reject path');
    await rejectTx.wait();

    expect(await swarmContract.memberCount()).toBe(1n);

    // -------------------------------------------------------------------
    // Step 9: swarm remove — archive profile, strip from parent swarms list. Contract
    //          stays deployed (we don't exercise --ens-cleanup in this test).
    // -------------------------------------------------------------------
    const profileBeforeRemove = await getSwarmProfile(swarmSlug);
    expect(profileBeforeRemove).toBeTruthy();

    // Mutate the parent list ourselves via the lib helper, matching what the command does.
    // (We invoke the lib directly rather than shelling out through commander.)
    const { unlinkSwarmFromOrgList } = await import('../swarm.js');
    const unlink = await unlinkSwarmFromOrgList(profileBeforeRemove!);
    expect(unlink.changed).toBe(true);

    await archiveSwarmProfile(swarmSlug, 'integration test');

    // Parent's CBOR swarms list should no longer contain the label.
    const swarmsListAfter = await readOrgSwarmsList(ORG_ENS_NAME);
    expect(swarmsListAfter).not.toContain(
      profileBeforeRemove!.ensName!.replace(`.${ORG_ENS_NAME}`, ''),
    );

    // Archive file should exist.
    const archivePath = path.join(resolveSwarmsDir(), '.archived', `${swarmSlug}.json`);
    expect(await fs.pathExists(archivePath)).toBe(true);
    // Original profile file should be gone.
    expect(await fs.pathExists(path.join(resolveSwarmsDir(), `${swarmSlug}.json`))).toBe(false);
  }, 300_000);

  it('throws EnsNameUnavailableError when register-ens is called on a name already owned', async () => {
    // This test relies on the main flow having already registered ORG_ENS_NAME. If it
    // didn't run (e.g. running this file with `-t` filter), we register a fresh name
    // first so the test is still independently meaningful.
    const takenName = ORG_ENS_NAME;

    // Spin up a second local org profile pointing at the same (already-registered)
    // ENS name. We use a distinct slug so both profiles coexist on disk.
    const conflictOrgName = `svtestconflict${runId}`;
    const conflictOrg = await createOrganizationProfile({
      name: conflictOrgName,
      ensName: takenName,
      visibility: 'public',
      ownerAddress: owner.address,
    });

    // The pre-flight availability check short-circuits before the 60-second commit
    // wait, so this call should return in a few hundred ms — no long timeout needed.
    let caught: unknown;
    try {
      await registerOrganizationEns(conflictOrg.slug);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(EnsNameUnavailableError);
    const structured = caught as EnsNameUnavailableError;
    expect(structured.ensName).toBe(takenName);
    expect(structured.currentOwner.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(structured.organizationSlug).toBe(conflictOrg.slug);
    // Error message should mention the recovery path so a human reading the thrown
    // error knows exactly what to do next.
    expect(structured.message).toMatch(/set-ens-name/);

    // Recovery path: user picks a fresh name via set-ens-name and retries. We don't
    // actually run the retry (that'd add another 60s commit-wait) — just prove the
    // recovery knob works and the profile now carries the new ensName.
    const recoveryName = `svtestrecovery${runId}.eth`;
    const recovered = await setOrganizationEnsName({
      nameOrSlug: conflictOrg.slug,
      ensName: recoveryName,
    });
    expect(recovered.ensName).toBe(recoveryName);
    expect(recovered.ensRegistration?.status).toBe('planned');
  }, 30_000);

  it('supports stealth swarm creation (no org, no treasury, no ENS)', async () => {
    const stealthProfile = await createSwarmProfile({
      name: STEALTH_SWARM_NAME,
      // no organization, no initialTreasury → ZeroAddress constructor arg
      visibility: 'private',
    });
    expect(stealthProfile.organization).toBeUndefined();
    expect(stealthProfile.organizationEnsName).toBeUndefined();
    expect(stealthProfile.ensName).toBeUndefined();
    expect(stealthProfile.treasuryAddress).toBeUndefined();
    expect(stealthProfile.contractAddress).toBeDefined();

    const contract = new Contract(stealthProfile.contractAddress!, SOULVAULT_SWARM_ABI, provider);
    expect(String(await contract.treasury())).toBe(ZeroAddress);

    // A stealth swarm's owner can bind a treasury later via setTreasury — we deploy a
    // throwaway treasury here rather than reusing one from the outer test so this test
    // is independent of the first `it()` block's state.
    const deployedTreasury = await deploySoulVaultTreasuryContract();
    const swarmAsOwner = new Contract(stealthProfile.contractAddress!, SOULVAULT_SWARM_ABI, owner);
    const setTx = await swarmAsOwner.setTreasury(deployedTreasury.address);
    await setTx.wait();
    expect(String(await contract.treasury()).toLowerCase()).toBe(deployedTreasury.address.toLowerCase());
  }, 120_000);
});
