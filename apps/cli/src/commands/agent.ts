import { Command } from 'commander';
import { createOrLoadAgentProfile, getAgentProfile } from '@soulvault/node/agent';
import { createAgentIdentityOnchain, renderAgentUri, showAgentIdentity, updateAgentIdentityOnchain } from '@soulvault/node/identity';
import { registerAgentEnsName, resolveAgentReverseRecord } from '@soulvault/node/ensv2-agent-bridge';
import { getActiveSwarm, getSwarmProfile } from '@soulvault/node/swarm';
import { loadEnv } from '@soulvault/node/config';

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
  const agent = program.command('agent').description('Local agent profile and ERC-8004 public identity operations')
    .addHelpText('after', `\nExamples:\n  soulvault agent create --name RustyBot --harness openclaw\n  soulvault agent register --swarm ops --name RustyBot\n  soulvault agent show\n  soulvault agent render-agenturi --swarm ops`);

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
    .command('register-ens')
    .description(
      'ENSv2 Phase 4 (ERC-8004 bridge): register the agent as <label>.<swarm>.<org>.eth in the org\'s ' +
        'SoulVaultRegistry and mirror the ERC-8004 identity (registry, agentId) into the name\'s resolver ' +
        'records. The agent wallet receives SET_RESOLVER | RENEW on its own name — self-serve record updates.',
    )
    .requiredOption('--label <label>', 'Agent label, e.g. rustybot for rustybot.<swarm>.<org>.eth')
    .option('--swarm <nameOrEns>', 'Swarm (default: active swarm)')
    .option('--owner <address>', 'Name owner (default: active signer)')
    .option('--expiry-days <n>', 'Name expiry in days', '30')
    .action(async (options) => {
      const result = await registerAgentEnsName({
        swarm: options.swarm,
        agentLabel: options.label,
        owner: options.owner,
        expirySeconds: Number(options.expiryDays) * 86400,
      });
      console.error(
        `\nAgent name registered: ${result.fullName}\n` +
          `  registry: ${result.registryAddress}\n` +
          `  owner: ${result.owner}\n` +
          `  roles on name: ${result.roleBitmap} (SET_RESOLVER=1<<24 | RENEW=1<<16)\n` +
          (result.erc8004.registry
            ? `  erc8004.registry: ${result.erc8004.registry}\n` +
              (result.erc8004.agentId ? `  erc8004.agentId: ${result.erc8004.agentId}\n` : '')
            : '') +
          `  tx: ${result.txHash}\n` +
          `\nReverse lookup: soulvault agent show resolves erc8004.* from this name.`,
      );
      console.log(JSON.stringify(result, null, 2));
    });

  agent
    .command('show')
    .option('--agent-id <id>')
    .option('--registry <address>')
    .option('--ens', 'Also resolve the ENSv2 ↔ ERC-8004 bridge records (reverse lookup)')
    .action(async (options) => {
      const result = await showAgentIdentity({
        agentId: options.agentId,
        registry: options.registry,
      });
      if (options.ens) {
        const bridge = await resolveAgentReverseRecord({});
        if (bridge) {
          console.error(
            `\nENSv2 bridge (${bridge.fullName}):\n` +
              `  erc8004.registry: ${bridge.erc8004.registry ?? '(unset)'}\n` +
              `  erc8004.agentId: ${bridge.erc8004.agentId ?? '(unset)'}`,
          );
        } else {
          console.error('\nENSv2 bridge: no agent ENS name registered (run `agent register-ens`).');
        }
      }
      console.log(JSON.stringify({ ...result, ensBridge: options.ens ? await resolveAgentReverseRecord({}).catch(() => null) : undefined }, null, 2));
    });
}
