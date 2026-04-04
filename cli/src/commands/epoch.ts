import { Command } from 'commander';
import { decryptBundleForCurrentMember, getLatestEpochBundle, rotateEpochWithBundle } from '../lib/epoch-bundle.js';

export function registerEpochCommands(program: Command) {
  const epoch = program.command('epoch').description('Swarm-scoped epoch bundle creation, rotation, and inspection')
    .addHelpText('after', `\nExamples:\n  soulvault epoch rotate --swarm ops\n  soulvault epoch show-bundle --swarm ops\n  soulvault epoch decrypt-bundle-member --swarm ops`);

  epoch
    .command('rotate')
    .option('--swarm <nameOrEns>')
    .option('--new-epoch <n>')
    .action(async (options) => {
      const result = await rotateEpochWithBundle({
        swarm: options.swarm,
        newEpoch: options.newEpoch ? Number(options.newEpoch) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  epoch
    .command('show-bundle')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await getLatestEpochBundle({ swarm: options.swarm });
      console.log(JSON.stringify(result, null, 2));
    });

  epoch
    .command('decrypt-bundle-member')
    .option('--swarm <nameOrEns>')
    .option('--print-key', 'Unsafe/dev: print raw unwrapped epoch key')
    .action(async (options) => {
      const result = await decryptBundleForCurrentMember({
        swarm: options.swarm,
        printKey: Boolean(options.printKey),
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
