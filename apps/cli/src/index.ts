#!/usr/bin/env node
import { Command } from 'commander';
import { registerOrganizationCommands } from './commands/organization.js';
import { registerSwarmCommands } from './commands/swarm.js';
import { registerTreasuryCommands } from './commands/treasury.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerIdentityCommands } from './commands/identity.js';
import { registerWorldCommands } from './commands/world.js';
import { registerBackupCommands } from './commands/backup.js';
import { registerRestoreCommands } from './commands/restore.js';
import { registerEpochCommands } from './commands/epoch.js';
import { registerRecoveryCommands } from './commands/recovery.js';
import { registerMessageCommands } from './commands/message.js';
import { registerDocumentCommands } from './commands/document.js';
import { registerSyncCommands } from './commands/sync.js';
import { registerStatusCommand } from './commands/status.js';
import { registerEnsCommands } from './commands/ens.js';

const program = new Command();

program
  .name('soulvault')
  .description(
    'SoulVault CLI for organization/swarm/agent operations across 0G (ops) + Sepolia (ENS/identity). ' +
      'Backups: owner emits BackupRequested via `swarm backup-request`; members run `backup push` or watch with `swarm events watch --respond-backup`.'
  )
  .version('0.1.0')
  .addHelpText(
    'after',
    `
Backups (event-driven coordination):
  Owner / coordinator — trigger a swarm-wide backup wave (onchain BackupRequested):
    soulvault swarm backup-request --reason "checkpoint" [--swarm <nameOrEns>]
  Member — archive, encrypt with K_epoch, upload to 0G, write last-backup.json:
    soulvault backup push [--workspace <path>]
  Member — poll events and auto-run the backup response when BackupRequested fires:
    soulvault swarm events watch --respond-backup [--swarm <nameOrEns>]

Examples:
  soulvault status
  soulvault status --json
  soulvault status --offline
  soulvault organization create --name soulvault --ens-name soulvault.eth --public
  soulvault organization register-ens --organization soulvault.eth
  soulvault swarm create --organization soulvault.eth --name ops
  soulvault swarm member-identities --swarm ops
  soulvault swarm backup-request --swarm ops --reason "manual test checkpoint"
  soulvault agent register --swarm ops --name RustyBot`
  );

registerOrganizationCommands(program);
registerSwarmCommands(program);
registerTreasuryCommands(program);
registerAgentCommands(program);
registerIdentityCommands(program);
registerWorldCommands(program);
registerBackupCommands(program);
registerRestoreCommands(program);
registerEpochCommands(program);
registerRecoveryCommands(program);
registerMessageCommands(program);
registerDocumentCommands(program);
registerSyncCommands(program);
registerStatusCommand(program);
registerEnsCommands(program);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
