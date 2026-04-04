#!/usr/bin/env node
import { Command } from 'commander';
import { registerOrganizationCommands } from './commands/organization.js';
import { registerSwarmCommands } from './commands/swarm.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerIdentityCommands } from './commands/identity.js';
import { registerBackupCommands } from './commands/backup.js';
import { registerRestoreCommands } from './commands/restore.js';

const program = new Command();

program
  .name('soulvault')
  .description('SoulVault CLI for organization/swarm/agent operations across 0G (ops) + Sepolia (ENS/identity)')
  .version('0.1.0')
  .addHelpText('after', `\nExamples:\n  soulvault organization create --name soulvault --ens-name soulvault.eth --public\n  soulvault organization register-ens --organization soulvault.eth\n  soulvault swarm create --organization soulvault.eth --name ops\n  soulvault swarm member-identities --swarm ops\n  soulvault agent register --swarm ops --name RustyBot`);

registerOrganizationCommands(program);
registerSwarmCommands(program);
registerAgentCommands(program);
registerIdentityCommands(program);
registerBackupCommands(program);
registerRestoreCommands(program);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
