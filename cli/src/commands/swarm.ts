import { Command } from 'commander';
import { createSwarmProfile, getActiveSwarm, getSwarmProfile, listSwarmProfiles, useSwarm } from '../lib/swarm.js';
import { approveJoinSwarm, getJoinRequestStatus, listSwarmMembers, requestJoinSwarm } from '../lib/swarm-contract.js';
import { findAgentIdentitiesByWallet } from '../lib/identity.js';
import { getAgentProfile } from '../lib/agent.js';

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

  swarm
    .command('join-request')
    .option('--swarm <nameOrEns>')
    .option('--pubkey <hex>')
    .option('--pubkey-ref <ref>')
    .option('--metadata-ref <ref>')
    .action(async (options) => {
      const result = await requestJoinSwarm({
        swarm: options.swarm,
        pubkeyHex: options.pubkey,
        pubkeyRef: options.pubkeyRef,
        metadataRef: options.metadataRef,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('approve-join')
    .requiredOption('--request-id <id>')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await approveJoinSwarm({
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('join-status')
    .requiredOption('--request-id <id>')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await getJoinRequestStatus({
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('member-identities')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const roster = await listSwarmMembers({ swarm: options.swarm });
      const localAgent = await getAgentProfile();
      const members = await Promise.all(roster.members.map(async (member) => {
        const identities = await findAgentIdentitiesByWallet({ wallet: member.wallet });
        return {
          ...member,
          localAgentMatch: localAgent?.address?.toLowerCase() === member.wallet.toLowerCase(),
          identities: identities.identities,
        };
      }));
      console.log(JSON.stringify({
        swarm: roster.swarm,
        contractAddress: roster.contractAddress,
        members,
      }, null, 2));
    });
}
