import { Command } from 'commander';
import { createSwarmProfile, getActiveSwarm, getSwarmProfile, listSwarmProfiles, useSwarm } from '../lib/swarm.js';

export function registerSwarmCommands(program: Command) {
  const swarm = program.command('swarm').description('Swarm profiles and active swarm context');

  swarm
    .command('create')
    .option('--organization <nameOrEns>')
    .requiredOption('--name <name>')
    .option('--chain-id <id>')
    .option('--rpc <url>')
    .option('--owner <address>')
    .option('--contract <address>')
    .option('--ens-name <name>')
    .option('--public', 'Mark as publicly discoverable')
    .option('--private', 'Mark as private')
    .option('--semi-private', 'Mark as semi-private')
    .action(async (options) => {
      const visibility = options.public ? 'public' : options.private ? 'private' : options.semiPrivate ? 'semi-private' : undefined;
      const profile = await createSwarmProfile({
        organization: options.organization,
        name: options.name,
        chainId: options.chainId ? Number(options.chainId) : undefined,
        rpcUrl: options.rpc,
        ownerAddress: options.owner,
        contractAddress: options.contract,
        ensName: options.ensName,
        visibility,
      });
      console.log(JSON.stringify(profile, null, 2));
    });

  swarm
    .command('list')
    .action(async () => {
      const profiles = await listSwarmProfiles();
      console.log(JSON.stringify(profiles, null, 2));
    });

  swarm
    .command('use')
    .argument('<nameOrEns>')
    .action(async (nameOrEns) => {
      const profile = await useSwarm(nameOrEns);
      console.log(JSON.stringify(profile, null, 2));
    });

  swarm
    .command('status')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const profile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
      if (!profile) {
        throw new Error('No swarm profile found. Run `soulvault swarm create` first.');
      }
      console.log(JSON.stringify(profile, null, 2));
    });
}
