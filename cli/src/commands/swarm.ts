import { Command } from 'commander';
import { createSwarmProfile, getActiveSwarm, getSwarmProfile, listSwarmProfiles, useSwarm } from '../lib/swarm.js';
import { approveJoinSwarm, getJoinRequestStatus, listRecentSwarmEvents, listSwarmMembers, requestBackupForSwarm, requestJoinSwarm, watchSwarmEvents } from '../lib/swarm-contract.js';
import { findAgentIdentitiesByWallet } from '../lib/identity.js';
import { getAgentProfile } from '../lib/agent.js';
import { respondToBackupRequest } from '../lib/backup-respond.js';

export function registerSwarmCommands(program: Command) {
  const swarm = program
    .command('swarm')
    .description('Swarm profiles, contract lifecycle, backup-request coordination, events')
    .addHelpText('after', `\nExamples:\n  soulvault swarm create --organization soulvault.eth --name ops\n  soulvault swarm use ops\n  soulvault swarm join-request --swarm ops\n  soulvault swarm approve-join --swarm ops --request-id 1\n  soulvault swarm member-identities --swarm ops\n  soulvault swarm backup-request --swarm ops --reason "manual test checkpoint"\n  soulvault swarm events watch --swarm ops`);

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

  swarm
    .command('backup-request')
    .description('Emit BackupRequested on the swarm contract (owner/coordinator — signals members to back up)')
    .requiredOption('--reason <text>')
    .option('--swarm <nameOrEns>')
    .option('--epoch <n>')
    .option('--target-ref <ref>')
    .option('--deadline-seconds <n>')
    .action(async (options) => {
      const result = await requestBackupForSwarm({
        swarm: options.swarm,
        reason: options.reason,
        epoch: options.epoch ? Number(options.epoch) : undefined,
        targetRef: options.targetRef,
        deadlineSeconds: options.deadlineSeconds ? Number(options.deadlineSeconds) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const events = swarm.command('events').description('Inspect or watch live swarm contract events');

  events
    .command('list')
    .option('--swarm <nameOrEns>')
    .option('--from-block <n>')
    .option('--to-block <n>')
    .action(async (options) => {
      const result = await listRecentSwarmEvents({
        swarm: options.swarm,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
        toBlock: options.toBlock ? Number(options.toBlock) : undefined,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  events
    .command('watch')
    .option('--swarm <nameOrEns>')
    .option('--poll-seconds <n>', 'Polling interval in seconds', '5')
    .option('--from-block <n>')
    .option('--once', 'Poll once and exit', false)
    .option('--respond-backup', 'When BackupRequested is observed, run backup/upload/mapping response', false)
    .action(async (options) => {
      await watchSwarmEvents({
        swarm: options.swarm,
        pollSeconds: options.pollSeconds ? Number(options.pollSeconds) : undefined,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
        once: Boolean(options.once),
        onEvents: options.respondBackup ? async (batch) => {
          for (const event of batch.events) {
            if (event.type !== 'BackupRequested') continue;
            const backupEvent = event as { type: 'BackupRequested'; epoch?: string; reason?: string };
            try {
              const result = await respondToBackupRequest({
                swarm: options.swarm,
                epoch: Number(backupEvent.epoch),
                reason: backupEvent.reason,
              });
              console.log(JSON.stringify({ type: 'BackupResponseCompleted', result }, null, 2));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              console.error(`Backup response failed: ${message}`);
            }
          }
        } : undefined,
      });
    });
}
