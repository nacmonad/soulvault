import { Command } from 'commander';
import {
  createAgentIdentityOnchain,
  renderAgentUri,
  showAgentIdentity,
  updateAgentIdentityOnchain,
} from '../lib/identity.js';
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

export function registerIdentityCommands(program: Command) {
  const identity = program.command('identity').description('ERC-8004 identity helpers');

  identity
    .command('render-agenturi')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const result = await renderAgentUri({
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        registryAddress: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        swarmContract: options.swarmContract ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  identity
    .command('create-agent')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const result = await createAgentIdentityOnchain({
        registry: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        swarmContract: options.swarmContract ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });

      console.log(JSON.stringify(result, null, 2));
    });

  identity
    .command('update')
    .requiredOption('--agent-id <id>')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--registry <address>')
    .option('--swarm-contract <address>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const result = await updateAgentIdentityOnchain({
        agentId: options.agentId,
        registry: options.registry ?? env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        name: options.name,
        description: options.description,
        image: options.image,
        services: parseServices(options.service as string[]),
        swarmContract: options.swarmContract ?? env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  identity
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
