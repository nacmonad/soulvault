import { Command } from 'commander';
import {
  grantEnsV2RoleByName,
  revokeEnsV2RoleByName,
  readEnsV2RolesByName,
  grantEnsV2RootRoles,
  revokeEnsV2RootRoles,
  readEnsV2RootRoles,
  authorizeEnsV2ResolverRoles,
  readEnsV2ResolverRoles,
} from '@soulvault/node/ensv2-grants';

export function registerEnsCommands(program: Command) {
  const ens = program
    .command('ens')
    .description(
      'ENSv2 EAC role operations on the org namespace (scoped delegation — grant agents exactly the roles they need on one name)',
    );

  ens
    .command('grant')
    .description(
      'Grant EAC roles on a name\'s resource to a wallet. EAC semantics: you can only grant roles you hold yourself. ' +
        'Example: soulvault ens grant --name ops.soulvault.eth --role set-resolver --to 0xAgent... — the agent can then ' +
        'update its own ENS records without the org wallet ever signing.',
    )
    .requiredOption('--name <name>', 'Fully-qualified name, e.g. ops.soulvault.eth')
    .requiredOption('--role <roles>', 'Comma-separated roles: set-resolver, renew, registrar, unregister, set-parent, set-subregistry, register-reserved')
    .requiredOption('--to <address>', 'Recipient wallet (agent)')
    .action(async (options) => {
      const result = await grantEnsV2RoleByName({
        fullName: options.name,
        roleSpec: options.role,
        account: options.to,
      });
      console.error(
        `\nGranted ${result.roles.join(', ')} on ${result.fullName} → ${result.account}\n` +
          `  resource: ${result.resource}\n` +
          `  registry: ${result.registryAddress}\n` +
          `  tx: ${result.txHash}\n` +
          `\nThe agent can now write its own records: their signer calls setEnsText directly.`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('revoke')
    .description(
      'Revoke EAC roles on a name\'s resource from a wallet (agent offboarding / role rotation).',
    )
    .requiredOption('--name <name>', 'Fully-qualified name')
    .requiredOption('--role <roles>', 'Comma-separated roles to revoke')
    .requiredOption('--from <address>', 'Wallet losing the roles')
    .action(async (options) => {
      const result = await revokeEnsV2RoleByName({
        fullName: options.name,
        roleSpec: options.role,
        account: options.from,
      });
      console.error(
        `\nRevoked ${result.roles.join(', ')} on ${result.fullName} from ${result.account}\n` +
          `  tx: ${result.txHash}`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('roles')
    .description(
      'Read the EAC roles an account holds on a name (bitmap + decoded role names).',
    )
    .requiredOption('--name <name>', 'Fully-qualified name')
    .requiredOption('--account <address>', 'Wallet to inspect')
    .action(async (options) => {
      const result = await readEnsV2RolesByName({
        fullName: options.name,
        account: options.account,
      });
      if (!result) {
        console.error(`Name "${options.name}" is not registered on ENSv2.`);
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    });

  // --- Root-resource grant family (registry-level, not name-scoped) ---------
  //
  // Registering a NEW label checks ROLE_REGISTRAR on the registry's ROOT
  // resource (resource 0) — roles on any parent name do not inherit down for
  // registration. `ens grant` is name-keyed and cannot express that, so
  // root grants take the registry address directly.

  ens
    .command('grant-root')
    .description(
      'Grant EAC roles on a registry\'s ROOT resource (resource 0). Needed for agent self-registration:' +
        ' registering a fresh label requires ROLE_REGISTRAR at the registry root, which name-scoped grants cannot express. ' +
        'EAC semantics: the caller must hold the roles at the root (the org owner does — EAC_ALL_ROLES at initialize()). ' +
        'Example: soulvault ens grant-root --registry 0xAbC... --role registrar --to 0xAgent...',
    )
    .requiredOption('--registry <address>', 'Org ENSv2 registry address (org profile ensv2Registry.address)')
    .requiredOption('--role <roles>', 'Comma-separated roles: registrar, register-reserved, set-parent, unregister, renew, set-subregistry, set-resolver')
    .requiredOption('--to <address>', 'Recipient wallet (agent)')
    .action(async (options) => {
      const result = await grantEnsV2RootRoles({
        registryAddress: options.registry,
        roleSpec: options.role,
        account: options.to,
      });
      console.error(
        `\nGranted ${result.roles.join(', ')} on ROOT of ${result.registryAddress} → ${result.account}\n` +
          `  tx: ${result.txHash}\n` +
          `\nThe agent can now register fresh labels on this registry (e.g. its own subdomain).`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('revoke-root')
    .description(
      'Revoke EAC roles on a registry\'s ROOT resource (agent offboarding at registry level).',
    )
    .requiredOption('--registry <address>', 'Org ENSv2 registry address')
    .requiredOption('--role <roles>', 'Comma-separated roles to revoke')
    .requiredOption('--from <address>', 'Wallet losing the roles')
    .action(async (options) => {
      const result = await revokeEnsV2RootRoles({
        registryAddress: options.registry,
        roleSpec: options.role,
        account: options.from,
      });
      console.error(
        `\nRevoked ${result.roles.join(', ')} on ROOT of ${result.registryAddress} from ${result.account}\n` +
          `  tx: ${result.txHash}`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('roles-root')
    .description(
      'Read the EAC roles an account holds on a registry\'s ROOT resource (bitmap + decoded role names).',
    )
    .requiredOption('--registry <address>', 'Org ENSv2 registry address')
    .requiredOption('--account <address>', 'Wallet to inspect')
    .action(async (options) => {
      const result = await readEnsV2RootRoles({
        registryAddress: options.registry,
        account: options.account,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  // --- Resolver-side EAC (record-level delegation) ---------------------------
  // Registry and resolver are separate EAC trust domains: holding registry roles
  // says nothing about writing records THROUGH the resolver. The resolver
  // authorizers are name+record-part scoped — the finest delegation in the
  // stack (an agent may edit one text key on one name and nothing else).

  ens
    .command('authorize-text')
    .description(
      'Grant/revoke ROLE_SET_TEXT on a resolver for ONE text key on ONE name (record-level EAC). ' +
        'This is the resolver-side trust domain — registry roles do not cross over. ' +
        'Example: soulvault ens authorize-text --resolver 0xAbC... --name charlie.ops.soulvault.eth ' +
        "--key soulvault.agentName --to 0xAgent... — the agent can then write exactly that record.",
    )
    .requiredOption('--resolver <address>', 'PermissionedResolver address holding the name\'s records')
    .requiredOption('--name <name>', 'Fully-qualified name, e.g. charlie.ops.soulvault.eth')
    .requiredOption('--key <key>', 'Text record key to scope the grant to, e.g. soulvault.agentName')
    .requiredOption('--to <address>', 'Recipient wallet (agent)')
    .option('--revoke', 'Revoke instead of grant', false)
    .action(async (options) => {
      const result = await authorizeEnsV2ResolverRoles({
        resolverAddress: options.resolver,
        fullName: options.name,
        key: options.key,
        account: options.to,
        grant: !options.revoke,
      });
      console.error(
        `\n${result.grant ? 'Granted' : 'Revoked'} set-text(${result.key}) on ${result.fullName} ` +
          `${result.grant ? '→' : '←'} ${result.account}\n` +
          `  resolver: ${result.resolverAddress}\n` +
          `  resource: ${result.resource}\n` +
          `  tx: ${result.txHash}\n` +
          `\nThe agent can now setText(${result.key}) on ${result.fullName} through this resolver directly.`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('authorize-name')
    .description(
      'Grant/revoke resolver roles node-wide on a name (authorizeNameRoles — covers all record types ' +
        'the granted roles cover). Resolver-side trust domain. ' +
        'Example: soulvault ens authorize-name --resolver 0xAbC... --name charlie.ops.soulvault.eth ' +
        '--role set-text,set-name --to 0xAgent...',
    )
    .requiredOption('--resolver <address>', 'PermissionedResolver address')
    .requiredOption('--name <name>', 'Fully-qualified name')
    .requiredOption('--role <roles>', 'Comma-separated resolver roles: set-addr, set-text, set-contenthash, set-pubkey, set-abi, set-interface, set-name, clear')
    .requiredOption('--to <address>', 'Recipient wallet (agent)')
    .option('--revoke', 'Revoke instead of grant', false)
    .action(async (options) => {
      const result = await authorizeEnsV2ResolverRoles({
        resolverAddress: options.resolver,
        fullName: options.name,
        roleSpec: options.role,
        account: options.to,
        grant: !options.revoke,
      });
      console.error(
        `\n${result.grant ? 'Granted' : 'Revoked'} ${result.roles.join(', ')} (node-wide) on ${result.fullName} ` +
          `${result.grant ? '→' : '←'} ${result.account}\n` +
          `  resolver: ${result.resolverAddress}\n` +
          `  resource: ${result.resource}\n` +
          `  tx: ${result.txHash}`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  ens
    .command('resolver-roles')
    .description(
      'Read the resolver-side EAC roles an account holds on a name (node-wide, or scoped to one text key).',
    )
    .requiredOption('--resolver <address>', 'PermissionedResolver address')
    .requiredOption('--name <name>', 'Fully-qualified name')
    .requiredOption('--account <address>', 'Wallet to inspect')
    .option('--key <key>', 'Inspect the text-key-scoped resource instead of the node-wide one')
    .action(async (options) => {
      const result = await readEnsV2ResolverRoles({
        resolverAddress: options.resolver,
        fullName: options.name,
        account: options.account,
        key: options.key,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
