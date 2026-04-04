import type { Command } from 'commander';
import { loadEnv } from '../lib/config.js';
import { parseCommaList, parseSyncEnsLists, runLedgerStateSync } from '../lib/ledger-sync.js';
import { describeSigner } from '../lib/signer.js';

export function registerSyncCommands(program: Command) {
  program
    .command('sync')
    .description(
      'Sync local organization/swarm JSON from ENS text records and on-chain owners (ops chain). ' +
        'Requires ENS names via env or flags; wallet must own the org on ENS and the swarm contract.',
    )
    .option('--organization-ens <names>', 'Comma-separated org ENS names (overrides SOULVAULT_SYNC_ORGANIZATION_ENS)')
    .option('--swarm-ens <names>', 'Comma-separated swarm ENS names (overrides SOULVAULT_SYNC_SWARM_ENS)')
    .action(async (opts: { organizationEns?: string; swarmEns?: string }) => {
      loadEnv();
      const lists = parseSyncEnsLists();
      const organizationEns = (opts.organizationEns ? parseCommaList(opts.organizationEns) : lists.organizations) ?? [];
      const swarmEns = (opts.swarmEns ? parseCommaList(opts.swarmEns) : lists.swarms) ?? [];

      if (organizationEns.length === 0 && swarmEns.length === 0) {
        throw new Error(
          'Nothing to sync. Set SOULVAULT_SYNC_ORGANIZATION_ENS and/or SOULVAULT_SYNC_SWARM_ENS, or use --organization-ens / --swarm-ens.',
        );
      }

      const { address } = await describeSigner({ skipLedgerAutoSync: true });
      const result = await runLedgerStateSync({
        walletAddress: address,
        organizationEns,
        swarmEns,
        verbose: true,
      });

      const failed = [...result.organizations, ...result.swarms].filter((x) => !x.ok);
      for (const w of result.warnings) {
        console.error(`warning: ${w}`);
      }
      if (failed.length) {
        for (const f of failed) {
          console.error(`failed: ${f.ens} — ${f.error}`);
        }
        process.exitCode = 1;
      }

      console.log(JSON.stringify(result, null, 2));
    });
}
