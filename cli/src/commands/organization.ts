import { Command } from 'commander';
import {
  createOrganizationProfile,
  getActiveOrganization,
  getOrganizationProfile,
  listOrganizationProfiles,
  setOrganizationEnsName,
  useOrganization,
} from '../lib/organization.js';
import { registerOrganizationEns } from '../lib/ens-name.js';
import {
  approveFundRequestViaOrganization,
  depositToOrganization,
  getOrganizationStatus,
  isRawAddress,
  rejectFundRequestViaOrganization,
  withdrawFromOrganization,
} from '../lib/organization-contract.js';
import {
  buildOrganizationContractProfile,
  getOrganizationContractProfile,
  listOrganizationContractProfiles,
  resolveTargetOrganization,
  writeOrganizationContractProfile,
} from '../lib/organization-state.js';
import {
  bindOrganizationEnsTextRecords,
  deploySoulVaultOrganizationContract,
  setOrganizationMetadataEnsRecords,
} from '../lib/organization-deploy.js';
import { listFundRequests } from '../lib/swarm-contract.js';

export function registerOrganizationCommands(program: Command) {
  const organization = program
    .command('organization')
    .description(
      'Organization profiles, contract deployment, treasury operations, swarm registry, and ENS root context.',
    )
    .addHelpText(
      'after',
      `\nExamples:\n` +
        `  soulvault organization create --name soulvault --ens-name soulvault.eth --public\n` +
        `  soulvault organization deploy --organization soulvault.eth\n` +
        `  soulvault organization deposit --amount 5\n` +
        `  soulvault organization status --organization soulvault.eth\n` +
        `  soulvault organization approve-fund --swarm ops --request-id 1\n` +
        `  soulvault organization register-ens --organization soulvault.eth`,
    );

  // --- Local profile management ---

  organization
    .command('create')
    .description('Create a local organization profile')
    .requiredOption('--name <name>')
    .option('--ens-name <name>')
    .option('--owner <address>')
    .option('--public', 'Mark as publicly discoverable')
    .option('--private', 'Mark as private')
    .option('--semi-private', 'Mark as semi-private')
    .action(async (options) => {
      const visibility = options.public ? 'public' : options.private ? 'private' : options.semiPrivate ? 'semi-private' : undefined;
      const profile = await createOrganizationProfile({
        name: options.name,
        ensName: options.ensName,
        ownerAddress: options.owner,
        visibility,
      });
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('list')
    .description('List all local organization profiles')
    .action(async () => {
      const profiles = await listOrganizationProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });

  organization
    .command('use')
    .description('Set the active organization')
    .argument('<nameOrEns>')
    .action(async (nameOrEns) => {
      const profile = await useOrganization(nameOrEns);
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('status')
    .description('Show organization profile and contract status (owner, balance)')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const profile = options.organization
        ? await getOrganizationProfile(options.organization)
        : await getActiveOrganization();
      if (!profile) {
        throw new Error('No organization profile found. Run `soulvault organization create` first.');
      }
      let contractStatus;
      try {
        contractStatus = await getOrganizationStatus({ organization: options.organization ?? profile.slug });
      } catch {
        // contract may not be deployed yet
      }
      console.log(JSON.stringify({ profile, contract: contractStatus ?? null }, null, 2));
    });

  // --- ENS ---

  organization
    .command('set-ens-name')
    .description(
      'Set the root .eth name on an existing local organization profile (needed before register-ens if create omitted --ens-name).',
    )
    .requiredOption('--organization <nameOrSlug>', 'Organization slug, name, or existing ensName')
    .requiredOption('--ens-name <name>', 'Root ENS name, e.g. soulvault-ledger.eth')
    .action(async (options) => {
      const profile = await setOrganizationEnsName({
        nameOrSlug: options.organization,
        ensName: options.ensName,
      });
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('register-ens')
    .description('Register the organization ENS name on Sepolia')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const target = options.organization ?? (await getActiveOrganization())?.slug;
      if (!target) {
        throw new Error('No organization selected. Pass --organization or set an active organization first.');
      }
      const result = await registerOrganizationEns(target);
      console.log(JSON.stringify(result, null, 2));
    });

  // --- Contract deployment (was `treasury create`) ---

  organization
    .command('deploy')
    .description('Deploy a SoulVaultOrganization contract and bind ENS text records')
    .option('--organization <nameOrEns>')
    .option('--force', 'Overwrite an existing contract profile', false)
    .option('--dao-uri <url>', 'ERC-4824 daoURI text record')
    .option('--members-uri <url>', 'soulvault.membersURI text record')
    .option('--governance-uri <url>', 'soulvault.governanceURI text record')
    .option('--contracts-uri <url>', 'soulvault.contractsURI text record')
    .action(async (options) => {
      const org = await resolveTargetOrganization(options.organization);
      const existing = await getOrganizationContractProfile(org.slug);
      if (existing && !options.force) {
        throw new Error(
          `Contract already exists for organization "${org.slug}" at ${existing.contractAddress}. ` +
            `Pass --force to overwrite.`,
        );
      }

      const deployment = await deploySoulVaultOrganizationContract();

      let ensBinding;
      if (org.ensName) {
        try {
          const bound = await bindOrganizationEnsTextRecords({
            organizationEnsName: org.ensName,
            contractAddress: deployment.address,
            daoURI: options.daoUri,
            membersURI: options.membersUri,
            governanceURI: options.governanceUri,
            contractsURI: options.contractsUri,
          });
          ensBinding = {
            status: 'bound' as const,
            chainIdTextTxHash: bound.chainIdTextTxHash,
            contractTextTxHash: bound.contractTextTxHash,
            ...(bound.daoURITextTxHash !== undefined && { daoURITextTxHash: bound.daoURITextTxHash }),
            ...(bound.membersURITextTxHash !== undefined && {
              membersURITextTxHash: bound.membersURITextTxHash,
            }),
            ...(bound.governanceURITextTxHash !== undefined && {
              governanceURITextTxHash: bound.governanceURITextTxHash,
            }),
            ...(bound.contractsURITextTxHash !== undefined && {
              contractsURITextTxHash: bound.contractsURITextTxHash,
            }),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[organization deploy] ENS binding skipped: ${message}`);
          ensBinding = { status: 'planned' as const };
        }
      }

      const profile = buildOrganizationContractProfile({
        organization: org.slug,
        organizationEnsName: org.ensName,
        contractAddress: deployment.address,
        ownerAddress: deployment.ownerAddress,
        deploymentTxHash: deployment.txHash,
        ensBinding,
      });

      await writeOrganizationContractProfile(profile);
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('set-metadata')
    .description('Update ERC-4824-style ENS text records on the organization root name')
    .option('--organization <nameOrEns>')
    .option('--dao-uri <url>', 'ERC-4824 daoURI text record')
    .option('--members-uri <url>', 'soulvault.membersURI text record')
    .option('--governance-uri <url>', 'soulvault.governanceURI text record')
    .option('--contracts-uri <url>', 'soulvault.contractsURI text record')
    .action(async (options) => {
      const org = await resolveTargetOrganization(options.organization);
      if (!org.ensName) {
        throw new Error(
          'Organization has no ENS name. Set it with `soulvault organization set-ens-name` or recreate the profile with --ens-name.',
        );
      }
      const result = await setOrganizationMetadataEnsRecords({
        organizationEnsName: org.ensName,
        daoURI: options.daoUri,
        membersURI: options.membersUri,
        governanceURI: options.governanceUri,
        contractsURI: options.contractsUri,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  // --- Treasury operations ---

  organization
    .command('deposit')
    .description('Send native value from your signer wallet into the organization contract')
    .requiredOption('--amount <ether>', 'Amount in ether (whole units)')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await depositToOrganization({
        organization: options.organization,
        amountEther: options.amount,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  organization
    .command('withdraw')
    .description('Organization owner withdraws native value from the contract')
    .requiredOption('--to <address>', 'Recipient address')
    .requiredOption('--amount <ether>', 'Amount in ether (whole units)')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await withdrawFromOrganization({
        organization: options.organization,
        to: options.to,
        amountEther: options.amount,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  organization
    .command('approve-fund')
    .description('Approve a pending fund request on the given swarm and release funds')
    .requiredOption('--swarm <nameOrAddress>', 'Swarm name/slug (local profile) or raw contract address')
    .requiredOption('--request-id <id>')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      if (isRawAddress(options.swarm)) {
        console.error(
          `[warning] --swarm is a raw contract address. Make sure this is a swarm you trust — ` +
            `the organization will release funds in the same transaction if this call succeeds.`,
        );
      }
      const result = await approveFundRequestViaOrganization({
        organization: options.organization,
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  organization
    .command('reject-fund')
    .description('Reject a pending fund request on the given swarm (no funds move)')
    .requiredOption('--swarm <nameOrAddress>')
    .requiredOption('--request-id <id>')
    .requiredOption('--reason <text>')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const result = await rejectFundRequestViaOrganization({
        organization: options.organization,
        swarm: options.swarm,
        requestId: options.requestId,
        reason: options.reason,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const fundRequests = organization
    .command('fund-requests')
    .description('Inspect fund requests across a swarm');

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

  organization
    .command('contracts')
    .description('List all local organization contract profiles')
    .action(async () => {
      const profiles = await listOrganizationContractProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });
}
