import { Command } from 'commander';
import { createOrLoadAgentProfile, getAgentProfile } from '../lib/agent.js';
import { createAgentIdentityOnchain, renderAgentUri, showAgentIdentity, updateAgentIdentityOnchain } from '../lib/identity.js';
import { getActiveSwarm, getSwarmProfile } from '../lib/swarm.js';
import { loadEnv } from '../lib/config.js';

function collectServices(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

function parseServices(serviceEntries: string[]) {
  return serviceEntries.map((entry) => {
    const [type, url] = entry.split('=');
    if (!type || !url) {
      throw new Error(`Invalid --service value: ${entry}. Expected type=url`);
    }
    return { type, url };
  });
}

async function resolveDefaultSwarmContract(explicit?: string) {
  if (explicit) return explicit;
  const active = await getActiveSwarm();
  return active?.contractAddress;
}

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

  agent
    .command('render-agenturi')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm <nameOrEns>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const swarmProfile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
      const result = await renderAgentUri({
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        registryAddress: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        swarmContract: options.swarmContract ?? swarmProfile?.contractAddress ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  agent
    .command('register')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm <nameOrEns>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const swarmProfile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
      const result = await createAgentIdentityOnchain({
        registry: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        swarmContract: options.swarmContract ?? swarmProfile?.contractAddress ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  agent
    .command('update')
    .requiredOption('--agent-id <id>')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm <nameOrEns>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const swarmProfile = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
      const result = await updateAgentIdentityOnchain({
        agentId: options.agentId,
        registry: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        swarmContract: options.swarmContract ?? swarmProfile?.contractAddress ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  agent
    .command('show')
    .option('--agent-id <id>')
    .option('--registry <address>')
    .action(async (options) => {
      const result = await showAgentIdentity({
        agentId: options.agentId,
        registry: options.registry,
      });
      console.log(JSON.stringify(result, null, 2));
    });
}
