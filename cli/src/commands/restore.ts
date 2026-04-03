import { Command } from 'commander';
import { decryptArchiveWithEpochKey } from '../lib/restore.js';

export function registerRestoreCommands(program: Command) {
  const restore = program.command('restore').description('Restore flows');

  restore
    .command('pull')
    .requiredOption('--encrypted <path>')
    .requiredOption('--nonce <hex>')
    .requiredOption('--aad <text>')
    .requiredOption('--auth-tag <hex>')
    .requiredOption('--output <path>')
    .action(async (options) => {
      await decryptArchiveWithEpochKey({
        encryptedPath: options.encrypted,
        nonceHex: options.nonce,
        aad: options.aad,
        authTagHex: options.authTag,
        outputPath: options.output,
      });

      console.log(JSON.stringify({ restoredTo: options.output }, null, 2));
    });
}
