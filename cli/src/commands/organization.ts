import { Command } from 'commander';
import {
  createOrganizationProfile,
  getActiveOrganization,
  getOrganizationProfile,
  listOrganizationProfiles,
  useOrganization,
} from '../lib/organization.js';
import { registerOrganizationEns } from '../lib/ens-name.js';

export function registerOrganizationCommands(program: Command) {
  const organization = program.command('organization').description('Organization profiles, ENS root context, and owner actions')
    .addHelpText('after', `\nExamples:\n  soulvault organization create --name soulvault --ens-name soulvault.eth --public\n  soulvault organization list\n  soulvault organization status --organization soulvault.eth\n  soulvault organization register-ens --organization soulvault.eth`);

  organization
    .command('create')
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
    .action(async () => {
      const profiles = await listOrganizationProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });

  organization
    .command('use')
    .argument('<nameOrEns>')
    .action(async (nameOrEns) => {
      const profile = await useOrganization(nameOrEns);
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('status')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const profile = options.organization
        ? await getOrganizationProfile(options.organization)
        : await getActiveOrganization();
      if (!profile) {
        throw new Error('No organization profile found. Run `soulvault organization create` first.');
      }
      console.log(JSON.stringify(profile, null, 2));
    });

  organization
    .command('register-ens')
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const target = options.organization ?? (await getActiveOrganization())?.slug;
      if (!target) {
        throw new Error('No organization selected. Pass --organization or set an active organization first.');
      }
      const result = await registerOrganizationEns(target);
      console.log(JSON.stringify(result, null, 2));
    });
}
