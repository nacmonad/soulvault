import { Command } from 'commander';
import { renderAgentUri } from '../lib/identity.js';
import { loadEnv } from '../lib/config.js';

function collectServices(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

export function registerIdentityCommands(program: Command) {
  const identity = program.command('identity').description('ERC-8004 identity helpers');

  identity
    .command('render-agenturi')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const services = (options.service as string[]).map((entry) => {
        const [type, url] = entry.split('=');
        return { type, url };
      });
      const result = await renderAgentUri({
        name: options.name,
        description: options.description,
        image: options.image,
        services,
        registryAddress: env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        swarmContract: env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  identity
    .command('create-agent')
    .option('--name <name>')
    .option('--description <description>')
    .option('--image <image>')
    .option('--service <type=url>', 'Repeatable service entries', collectServices, [])
    .action(async (options) => {
      const env = loadEnv();
      const services = (options.service as string[]).map((entry) => {
        const [type, url] = entry.split('=');
        return { type, url };
      });
      const result = await renderAgentUri({
        name: options.name,
        description: options.description,
        image: options.image,
        services,
        registryAddress: env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        swarmContract: env.SOULVAULT_DEFAULT_SWARM_ADDRESS,
      });

      console.log(JSON.stringify({
        note: 'Scaffolded create-agent flow ready. Next step is wiring the actual ERC-8004 registry call.',
        registry: env.SOULVAULT_ERC8004_REGISTRY_ADDRESS,
        agentURI: result.agentURI,
        payload: result.payload,
      }, null, 2));
    });
}
