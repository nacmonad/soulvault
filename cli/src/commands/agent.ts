import { Command } from 'commander';
import { createOrLoadAgentProfile, getAgentProfile } from '../lib/agent.js';

export function registerAgentCommands(program: Command) {
  const agent = program.command('agent').description('Local agent profile management');

  agent
    .command('create')
    .option('--name <name>')
    .option('--harness <harness>', 'Harness/runtime type', 'openclaw')
    .option('--backup-command <command>')
    .action(async (options) => {
      const profile = await createOrLoadAgentProfile(options);
      console.log(JSON.stringify(profile, null, 2));
    });

  agent
    .command('status')
    .action(async () => {
      const profile = await getAgentProfile();
      if (!profile) {
        throw new Error('No local agent profile found. Run `soulvault agent create` first.');
      }
      console.log(JSON.stringify(profile, null, 2));
    });
}
