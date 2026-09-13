import { Command } from 'commander';
import fs from 'fs-extra';
import {
  writeRecoveryEscrow,
  fastRestore,
  cycleRestoreStored,
  sweepAfterKick,
  resolveEscrowPaths,
} from '@soulvault/node/recovery-escrow';
import { openRingBackend } from '@soulvault/node/ring-backend';

export function registerRecoveryCommands(program: Command) {
  const recovery = program
    .command('recovery')
    .description(
      'Epoch key recovery without stored keys — Ledger Key Ring backed (see docs/epoch-key-ring-spec.md)',
    )
    .addHelpText(
      'after',
      `\nExamples:\n  soulvault recovery escrow --agent charlie.ops.soulvault-ensv2.eth --epoch 3 --archive memories.md\n  soulvault recovery restore --agent charlie.ops.soulvault-ensv2.eth --epoch 3\n  soulvault recovery restore --agent charlie.ops.soulvault-ensv2.eth --scan\n  soulvault recovery sweep --agent charlie.ops.soulvault-ensv2.eth`,
    );

  recovery
    .command('escrow')
    .description('Encrypt an archive under a ring-derived epoch key and store the escrow (header + body)')
    .requiredOption('--agent <ens>', 'Agent ENS subname (identity anchor for key derivation)')
    .requiredOption('--epoch <n>', 'Epoch number', Number.parseInt)
    .requiredOption('--archive <file>', 'File to escrow (e.g. harness memories markdown)')
    .option('--backend <kind>', 'Ring backend: ledger (real wallet-cli) or local (simulated)', 'local')
    .action(async (options) => {
      const payload = new Uint8Array(await (await import('node:fs/promises')).readFile(options.archive));
      const result = await writeRecoveryEscrow({
        agentId: options.agent,
        epoch: options.epoch,
        payload,
        backend: await openRingBackend(options.backend),
      });
      console.log(`Escrow written (${result.header.alg}):`);
      console.log(`  header: ${result.paths.headerPath}`);
      console.log(`  body:   ${result.paths.bodyPath} (sha256 ${result.bodySha256.slice(0, 16)}…)`);
      console.log(`  keyName: ${result.header.keyName}`);
      console.log('  keys on disk at rest: ZERO — derived in memory, then discarded');
    });

  recovery
    .command('restore')
    .description('Restore an escrowed archive — fast path (header) or cycle path (--scan)')
    .requiredOption('--agent <ens>', 'Agent ENS subname')
    .option('--epoch <n>', 'Epoch number (fast path)', Number.parseInt)
    .option('--scan', 'Cycle path: sweep epoch names via GCM auth (header lost)', false)
    .option('--out <file>', 'Output path for restored payload')
    .option('--backend <kind>', 'Ring backend: ledger or local', 'local')
    .action(async (options) => {
      const backend = await openRingBackend(options.backend);
      let epoch: number;
      let payload: Uint8Array;
      if (options.scan) {
        const r = await cycleRestoreStored({ agentId: options.agent, backend, maxEpoch: 64 });
        epoch = r.epoch;
        payload = r.payload;
        console.log(`Cycle path: sweep found epoch ${epoch} (GCM authenticated, no false positives possible)`);
      } else {
        if (options.epoch === undefined) throw new Error('either --epoch <n> or --scan is required');
        const r = await fastRestore({ agentId: options.agent, epoch: options.epoch, backend });
        epoch = r.header.epoch;
        payload = r.payload;
        console.log(`Fast path: restored via ${r.header.keyName}`);
      }
      const out = options.out ?? `restored-epoch-${epoch}.md`;
      await (await import('node:fs/promises')).writeFile(out, payload);
      console.log(`✅ restored ${payload.length} bytes → ${out}`);
    });

  recovery
    .command('sweep')
    .description('Post-kick sweep: decrypt escrows under pre-rotation generation, rotate, re-escrow post-rotation')
    .requiredOption('--agent <ens>', 'Agent ENS subname whose escrows to re-escrow')
    .option('--backend <kind>', 'Ring backend (sweep requires local — ledger cannot sweep)', 'local')
    .action(async (options) => {
      const backend = await openRingBackend(options.backend);
      const result = await sweepAfterKick({ agentId: options.agent, backend: backend as never });
      console.log(`Sweep complete for ${options.agent}:`);
      console.log(`  generation ${result.fromGeneration} → ${result.toGeneration}`);
      console.log(`  re-escrowed epochs: ${result.reEscrowedEpochs.join(', ') || '(none survived)'}`);
      console.log('  pre-rotation ciphertext is dead; rogue member can derive nothing');
    });

  recovery
    .command('show')
    .description('Show stored escrows for an agent')
    .requiredOption('--agent <ens>', 'Agent ENS subname')
    .action(async (options) => {
      const { headerPath, bodyPath } = resolveEscrowPaths(options.agent, 0);
      const dir = headerPath.replace(/epoch-\d+\.header\.json$/, '');
      const fsx = await import('fs-extra');
      if (!(await fsx.pathExists(dir))) {
        console.log(`No escrows for ${options.agent}`);
        return;
      }
      const files = await fsx.readdir(dir);
      const epochs = [...new Set(files.map((f) => f.match(/epoch-(\d+)\./)?.[1]).filter(Boolean))] as string[];
      for (const e of epochs) {
        const header = await fsx.readJson(headerPath.replace(/epoch-\d+/, `epoch-${e}`));
        console.log(`epoch ${Number(e)}: ${header.keyName} (${header.alg}, created ${header.createdAt})`);
      }
      void bodyPath;
    });
}
