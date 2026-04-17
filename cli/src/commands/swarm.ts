import { Command } from 'commander';
import { ZeroAddress, getAddress, parseEther } from 'ethers';
import {
  archiveSwarmProfile,
  createSwarmProfile,
  getActiveSwarm,
  getSwarmProfile,
  listSwarmProfiles,
  unlinkSwarmFromOrgList,
  updateSwarmProfile,
  useSwarm,
} from '../lib/swarm.js';
import { getOrganizationProfile } from '../lib/organization.js';
import { getAddrMultichain } from '../lib/ens.js';
import { loadEnv } from '../lib/config.js';
import {
  approveJoinSwarm,
  cancelFundRequestOnSwarm,
  getFundRequestStatus,
  getJoinRequestStatus,
  listFundRequests,
  listRecentSwarmEvents,
  listSwarmMembers,
  readSwarmTreasury,
  requestBackupForSwarm,
  requestFundsOnSwarm,
  requestJoinSwarm,
  setSwarmTreasury,
  watchSwarmEvents,
} from '../lib/swarm-contract.js';
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
    .description(
      'Deploy a new SoulVaultSwarm. With --organization, auto-discovers the org\'s ' +
        'treasury via ENSIP-11 addr on the org ENS name; without it, deploys a stealth ' +
        'swarm with no treasury and no ENS presence.',
    )
    .option('--organization <nameOrEns>')
    .requiredOption('--name <name>')
    .option('--chain-id <id>')
    .option('--rpc <url>')
    .option('--owner <address>')
    .option('--contract <address>')
    .option('--ens-name <name>')
    .option(
      '--treasury <address>',
      'Explicit treasury address (overrides org ENSIP-11 auto-discovery). Pass 0x0000000000000000000000000000000000000000 to deploy org-affiliated but treasury-less.',
    )
    .option('--public', 'Mark as publicly discoverable')
    .option('--private', 'Mark as private')
    .option('--semi-private', 'Mark as semi-private')
    .action(async (options) => {
      const visibility = options.public ? 'public' : options.private ? 'private' : options.semiPrivate ? 'semi-private' : undefined;

      // Resolve the treasury address using the three-mode precedence:
      //   1. --treasury <addr>           (explicit override, including 0x0 to opt out)
      //   2. --organization <x>          (ENSIP-11 auto-discovery on the org's ENS name)
      //   3. neither                     (stealth — ZeroAddress constructor arg)
      let initialTreasury: string = ZeroAddress;
      if (options.treasury) {
        initialTreasury = getAddress(options.treasury);
      } else if (options.organization) {
        const org = await getOrganizationProfile(options.organization);
        if (!org) throw new Error(`Organization not found: ${options.organization}`);
        if (!org.ensName) {
          throw new Error(
            `Organization "${org.slug}" has no ENS name configured, so the CLI cannot ` +
              `auto-discover a treasury. Either register the org's ENS name and create a ` +
              `treasury, pass --treasury <addr> explicitly, or omit --organization to deploy ` +
              `a stealth swarm.`,
          );
        }
        const env = loadEnv();
        const chainId = options.chainId ? Number(options.chainId) : env.SOULVAULT_CHAIN_ID;
        const discovered = await getAddrMultichain(org.ensName, chainId);
        if (!discovered) {
          throw new Error(
            `Organization "${org.slug}" has no treasury published on ENS for chain ${chainId}. ` +
              `Run \`soulvault treasury create --organization ${org.slug}\` first, ` +
              `pass --treasury 0x0000000000000000000000000000000000000000 to deploy ` +
              `org-affiliated but treasury-less, or omit --organization for a stealth swarm.`,
          );
        }
        initialTreasury = discovered;
      }

      const profile = await createSwarmProfile({
        organization: options.organization,
        name: options.name,
        chainId: options.chainId ? Number(options.chainId) : undefined,
        rpcUrl: options.rpc,
        ownerAddress: options.owner,
        contractAddress: options.contract,
        initialTreasury,
        ensName: options.ensName,
        visibility,
      });
      console.log(JSON.stringify(profile, null, 2));
    });

  swarm
    .command('remove')
    .description(
      'Remove a swarm from local state. Archives the profile to ~/.soulvault/swarms/.archived/, ' +
        'strips the swarm label from the parent org\'s ENS `soulvault.swarms` CBOR list, and ' +
        'leaves the on-chain contract deployed. Use --ens-cleanup to additionally clear the ' +
        'swarm subdomain\'s resolver records (opt-in to preserve recoverability by default).',
    )
    .requiredOption('--swarm <nameOrEns>', 'Swarm name/slug to remove')
    .option('--yes', 'Skip the confirmation prompt', false)
    .option('--reason <text>', 'Reason to record in the archive entry')
    .option(
      '--ens-cleanup',
      'Also clear the swarm subdomain resolver records (addr + text). Does not delete the subdomain ownership.',
      false,
    )
    .action(async (options) => {
      const profile = await getSwarmProfile(options.swarm);
      if (!profile) throw new Error(`Swarm not found: ${options.swarm}`);

      if (!options.yes) {
        // Non-interactive mode safety: we don't have a readline prompt wired in this
        // file, and the existing commands don't prompt either. Require --yes explicitly
        // rather than blocking on stdin, matching the CLI's current UX pattern.
        throw new Error(
          `Refusing to remove swarm "${profile.slug}" without --yes. ` +
            `This archives the local profile and mutates the org's ENS discovery list. ` +
            `Re-run with --yes to confirm.`,
        );
      }

      const unlink = await unlinkSwarmFromOrgList(profile);
      if (unlink.error) {
        console.error(
          `[swarm remove] WARNING: failed to update org's soulvault.swarms list: ${unlink.error} — ` +
            `continuing with local archive.`,
        );
      }

      if (options.ensCleanup) {
        console.error(
          `[swarm remove] NOTE: --ens-cleanup is declared but no subdomain resolver clearing ` +
            `is implemented in this pass. The subdomain records are left in place.`,
        );
      }

      const entry = await archiveSwarmProfile(profile.slug, options.reason);

      console.log(
        JSON.stringify(
          {
            slug: entry.slug,
            archivedAt: entry.archived.at,
            reason: entry.archived.reason,
            orgEnsListUpdated: unlink.changed,
            orgEnsListError: unlink.error,
            onChainContract: entry.contractAddress,
            note:
              entry.contractAddress && entry.contractAddress !== ZeroAddress
                ? `The on-chain swarm contract at ${entry.contractAddress} is still deployed. ` +
                  `Use a separate tool to interact with it if needed.`
                : undefined,
          },
          null,
          2,
        ),
      );
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

  // --- Treasury binding + fund request lifecycle ---

  swarm
    .command('set-treasury')
    .description('Swarm owner binds the swarm to a treasury contract (re-settable)')
    .requiredOption('--treasury <address>', 'Treasury contract address')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      // Warn if there are pending fund requests — the old treasury can no longer approve them.
      try {
        const pendingList = await listFundRequests({ swarm: options.swarm, statusFilter: 'pending' });
        if (pendingList.requests.length > 0) {
          console.error(
            `[warning] ${pendingList.requests.length} pending fund request(s) will be orphaned from the previous treasury. ` +
              `The previously-bound treasury will no longer be able to approve them (mutual-consent check will fail). ` +
              `Requesters can cancel and refile, or the new treasury can approve them.`,
          );
        }
      } catch {
        // best-effort; rebinds shouldn't fail just because event log query failed
      }
      const result = await setSwarmTreasury({ swarm: options.swarm, treasury: options.treasury });
      // Refresh the local profile cache.
      try {
        const active = options.swarm ? await getSwarmProfile(options.swarm) : await getActiveSwarm();
        if (active) {
          await updateSwarmProfile(active.slug, { treasuryAddress: options.treasury });
        }
      } catch {
        // profile refresh is best-effort
      }
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('treasury-status')
    .description('Read the currently-bound treasury address from the swarm contract')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await readSwarmTreasury({ swarm: options.swarm });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('fund-request')
    .description('Active member submits a fund request to the swarm (requires treasury bound)')
    .requiredOption('--amount <ether>', 'Requested amount in ether (whole units)')
    .requiredOption('--reason <text>')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const amountWei = parseEther(options.amount);
      const result = await requestFundsOnSwarm({
        swarm: options.swarm,
        amountWei,
        reason: options.reason,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('cancel-fund-request')
    .description('Requester cancels their own pending fund request')
    .requiredOption('--request-id <id>')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await cancelFundRequestOnSwarm({
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  swarm
    .command('fund-status')
    .description('Read the current state of a fund request by id')
    .requiredOption('--request-id <id>')
    .option('--swarm <nameOrEns>')
    .action(async (options) => {
      const result = await getFundRequestStatus({
        swarm: options.swarm,
        requestId: options.requestId,
      });
      console.log(JSON.stringify(result, null, 2));
    });

  const fundRequests = swarm
    .command('fund-requests')
    .description('Inspect fund requests on the swarm (requester perspective)');

  fundRequests
    .command('list')
    .option('--swarm <nameOrEns>')
    .option('--status <pending|approved|rejected|cancelled>')
    .option('--from-block <n>')
    .option('--to-block <n>')
    .action(async (options) => {
      const status = options.status as 'pending' | 'approved' | 'rejected' | 'cancelled' | undefined;
      const result = await listFundRequests({
        swarm: options.swarm,
        fromBlock: options.fromBlock ? Number(options.fromBlock) : undefined,
        toBlock: options.toBlock ? Number(options.toBlock) : undefined,
        statusFilter: status,
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
