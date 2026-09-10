import { Command } from 'commander';
import {
  createOrganizationProfile,
  getActiveOrganization,
  getOrganizationProfile,
  listOrganizationProfiles,
  setOrganizationEnsName,
  useOrganization,
} from '@soulvault/node/organization';
import {
  EnsNameInvalidError,
  EnsNameUnavailableError,
  registerOrganizationEns,
} from '@soulvault/node/ens-name';
import { setEnsResolver } from '@soulvault/node/ens';
import { deployEnsV2OrgRegistry } from '@soulvault/node/ensv2-registry';

export function registerOrganizationCommands(program: Command) {
  const organization = program.command('organization').description('Organization profiles, ENS root context, and owner actions')
    .addHelpText(
      'after',
      `\nExamples:\n  soulvault organization create --name soulvault --ens-name soulvault.eth --public\n  soulvault organization set-ens-name --organization soulvault --ens-name soulvault.eth\n  soulvault organization list\n  soulvault organization status --organization soulvault.eth\n  soulvault organization register-ens --organization soulvault.eth`,
    );

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
    .option('--organization <nameOrEns>')
    .action(async (options) => {
      const target = options.organization ?? (await getActiveOrganization())?.slug;
      if (!target) {
        throw new Error('No organization selected. Pass --organization or set an active organization first.');
      }
      try {
        const result = await registerOrganizationEns(target);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        // Catch the structured pre-flight errors and print an actionable recovery
        // prompt instead of a raw stack trace. Other errors (controller revert,
        // signer failure, etc.) fall through to commander's default handler.
        if (err instanceof EnsNameUnavailableError || err instanceof EnsNameInvalidError) {
          console.error(`\n✗ ${err.message}\n`);
          console.error('Next steps:');
          console.error(`  1. Pick a different ENS name (must end in .eth and be unowned).`);
          console.error(
            `  2. soulvault organization set-ens-name --organization ${err.organizationSlug} --ens-name <newName.eth>`,
          );
          console.error(`  3. soulvault organization register-ens --organization ${err.organizationSlug}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });

  organization
    .command('set-resolver')
    .description(
      'Point a registered ENS name\'s resolver at the SoulVault PublicResolver (idempotent; no-op when already set). ' +
        'Repair for org names registered before the register flow wired the resolver atomically — without it, ' +
        'standard ENS resolution of the org\'s records fails and third-party ENS tooling sees nothing. ' +
        'Requires the name\'s owner as signer (1 Ledger signature when a change is needed).',
    )
    .option('--organization <nameOrEns>', 'Defaults to the active organization\'s ensName')
    .option('--ens-name <name>', 'Explicit ENS name to repair (overrides --organization)')
    .action(async (options) => {
      let ensName = options.ensName;
      if (!ensName) {
        const target = options.organization ?? (await getActiveOrganization())?.slug;
        if (!target) {
          throw new Error('No organization selected. Pass --organization or set an active organization first.');
        }
        const profile = await getOrganizationProfile(target);
        if (!profile?.ensName) {
          throw new Error(
            `Organization "${target}" has no ENS name configured. Pass --ens-name explicitly or run \`soulvault organization set-ens-name\` first.`,
          );
        }
        ensName = profile.ensName;
      }
      const result = await setEnsResolver(ensName);
      if (result.alreadySet) {
        console.error(`Resolver for ${ensName} already points at ${result.resolver} — no transaction needed.`);
      } else {
        console.error(`Resolver set on ${ensName} → ${result.resolver} (tx: ${result.txHash})`);
      }
      console.log(JSON.stringify(result, null, 2));
    });

  organization
    .command('deploy-registry')
    .description(
      "ENSv2 Phase 2: deploy the org's SoulVaultRegistry (UserRegistry proxy) via the VerifiableFactory on Sepolia. " +
        'The registry becomes the authoritative *.org.eth subname namespace — swarm membership turns into real ' +
        'registry entries with epoch-bound expiries and EAC-scoped roles (replaces the CBOR soulvault.swarms list). ' +
        'The deployer receives ALL root roles; the proxy address is deterministic (caller-chosen salt) and verifiable onchain.',
    )
    .option('--salt <hex>', 'CREATE2 salt for the proxy (default: 0x5011 "S0ul")')
    .action(async (options) => {
      const salt = options.salt ? BigInt(options.salt) : undefined;
      const result = await deployEnsV2OrgRegistry({ salt });
      console.error(
        `\nSoulVaultRegistry deployed: ${result.registryAddress}\n` +
          `  owner: ${result.owner} (ALL root roles)\n` +
          `  implementation: ${result.implementationAddress}\n` +
          `  labelStore: ${result.labelStoreAddress}\n` +
          `  factory: ${result.verifiableFactoryAddress}\n` +
          `  tx: ${result.txHash}\n` +
          `\nNext: soulvault swarm register-ens --registry ${result.registryAddress} --swarm <name>`,
      );
      console.log(JSON.stringify(result, null, 2));
    });
}
