import { Command } from 'commander';
import {
  approveFundRequestViaTreasury,
  depositToTreasury,
  getTreasuryStatus,
  isRawAddress,
  rejectFundRequestViaTreasury,
  withdrawFromTreasury,
} from '../lib/treasury-contract.js';
import {
  buildTreasuryProfile,
  getTreasuryProfile,
  listTreasuryProfiles,
  resolveTargetOrganization,
  writeTreasuryProfile,
} from '../lib/treasury.js';
import {
  bindTreasuryEnsTextRecords,
  deploySoulVaultTreasuryContract,
} from '../lib/treasury-deploy.js';
import { listFundRequests } from '../lib/swarm-contract.js';

export function registerTreasuryCommands(program: Command) {
  const treasury = program
    .command('treasury')
    .description(
      'Org-scoped treasury contract. Holds native value, releases funds on approved fund requests. ' +
        'Discovered via ENS text records on the org ENS name.',
    )
    .addHelpText(
      'after',
      `\nExamples:\n` +
        `  soulvault treasury create --organization soulvault.eth\n` +
        `  soulvault treasury deposit --amount 5\n` +
        `  soulvault treasury status\n` +
        `  soulvault treasury approve-fund --swarm ops --request-id 1\n` +
        `  soulvault treasury reject-fund --swarm ops --request-id 2 --reason "budget exhausted"\n` +
        `  soulvault treasury fund-requests list --swarm ops --status pending`,
    );

  treasury
    .command('create')
    .description('Deploy a SoulVaultTreasury contract and bind it to the org\'s ENS text records.')
    .option('--organization <nameOrEns>')
    .option('--force', 'Overwrite an existing treasury profile for the organization', false)
    .action(async (options) => {
      const organization = await resolveTargetOrganization(options.organization);
      const existing = await getTreasuryProfile(organization.slug);
      if (existing && !options.force) {
        throw new Error(
          `Treasury already exists for organization "${organization.slug}" at ${existing.contractAddress}. ` +
            `Pass --force to overwrite.`,
        );
      }

      const deployment = await deploySoulVaultTreasuryContract();

      // Bind ENS text records if the org has a registered ENS name. Otherwise save a
      // "planned" binding the user can fix up later with a re-register.
      let ensBinding;
      if (organization.ensName) {
        try {
          const bound = await bindTreasuryEnsTextRecords({
            organizationEnsName: organization.ensName,
            contractAddress: deployment.address,
          });
          ensBinding = {
            status: 'bound' as const,
            chainIdTextTxHash: bound.chainIdTextTxHash,
            contractTextTxHash: bound.contractTextTxHash,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[treasury create] ENS binding skipped: ${message}`);
          ensBinding = { status: 'planned' as const };
        }
      }

      const profile = buildTreasuryProfile({
        organization: organization.slug,
        organizationEnsName: organization.ensName,
        contractAddress: deployment.address,
        ownerAddress: deployment.ownerAddress,
        deploymentTxHash: deployment.txHash,
        ensBinding,
      });

      await writeTreasuryProfile(profile);
      console.log(JSON.stringify(profile, null, 2));
    });

  treasury
    .command('list')
    .description('List all local treasury profiles')
    .action(async () => {
      const profiles = await listTreasuryProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });

  treasury
    .command('status')
    .description('Show the treasury contract address, balance, and owner')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const status = await getTreasuryStatus({ organization: options.organization });
      console.log(JSON.stringify(status, null, 2));
    });

  treasury
    .command('deposit')
    .description('Send native value from your signer wallet into the treasury')
    .requiredOption('--amount <ether>', 'Amount in ether (whole units)')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await depositToTreasury({
        organization: options.organization,
        amountEther: options.amount,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  treasury
    .command('withdraw')
    .description('Treasury owner withdraws native value from the treasury')
    .requiredOption('--to <address>', 'Recipient address')
    .requiredOption('--amount <ether>', 'Amount in ether (whole units)')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await withdrawFromTreasury({
        organization: options.organization,
        to: options.to,
        amountEther: options.amount,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  treasury
    .command('approve-fund')
    .description('Approve a pending fund request on the given swarm and release funds to the requester')
    .requiredOption('--swarm <nameOrAddress>', 'Swarm name/slug (local profile) or raw contract address')
    .requiredOption('--request-id <id>')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      if (isRawAddress(options.swarm)) {
        console.error(
          `[warning] --swarm is a raw contract address. Make sure this is a swarm you trust — ` +
            `the treasury will release funds in the same transaction if this call succeeds.`,
        );
      }
      const result = await approveFundRequestViaTreasury({
        organization: options.organization,
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  treasury
    .command('reject-fund')
    .description('Reject a pending fund request on the given swarm (no funds move)')
    .requiredOption('--swarm <nameOrAddress>')
    .requiredOption('--request-id <id>')
    .requiredOption('--reason <text>')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await rejectFundRequestViaTreasury({
        organization: options.organization,
        swarm: options.swarm,
        requestId: options.requestId,
        reason: options.reason,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const fundRequests = treasury
    .command('fund-requests')
    .description('Inspect fund requests across a swarm from the treasury\'s perspective');

  fundRequests
    .command('list')
    .requiredOption('--swarm <nameOrEns>')
    .option('--status <pending|approved|rejected|cancelled>')
    .option('--from-block <n>')
    .option('--to-block <n>')
    .action(async (options) => {
      const status = options.status as 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined;
      const result = await listFundRequests({
        swarm: options.swarm,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
        toBlock: options.toBlock ? Number(options.toBlock) : undefined,
        statusFilter: status,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
