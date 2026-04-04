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
  .description('SoulVault CLI scaffold for 0G-backed encrypted agent backups + ERC-8004 identity flows')
  .version('0.1.0');

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
