import { Command } from 'commander';
import { formatStatusText, gatherStatus } from '../lib/status.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show a unified summary of wallet, agent, organization, swarm, on-chain state, keys, backup, and environment')
    .option('--json', 'Output raw JSON instead of human-readable text')
    .option('--offline', 'Skip on-chain RPC calls (local state only)')
    .action(async (options) => {
      const report = await gatherStatus({ offline: options.offline });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatStatusText(report));
      }
    });
}
