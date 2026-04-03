import path from 'node:path';
import { Command } from 'commander';
import { createWorkspaceArchive, encryptArchiveWithEpochKey } from '../lib/backup.js';
import { uploadPreparedArtifact } from '../lib/0g.js';

export function registerBackupCommands(program: Command) {
  const backup = program.command('backup').description('Backup flows');

  backup
    .command('push')
    .option('--workspace <path>', 'Workspace to archive', process.cwd())
    .option('--skip-upload', 'Only create + encrypt the archive locally', false)
    .action(async (options) => {
      const workspace = path.resolve(options.workspace);
      const archivePath = await createWorkspaceArchive(workspace);
      const encrypted = await encryptArchiveWithEpochKey(archivePath);

      if (options.skipUpload) {
        console.log(JSON.stringify({ archivePath, ...encrypted }, null, 2));
        return;
      }

      const upload = await uploadPreparedArtifact(encrypted.encryptedPath);
      console.log(JSON.stringify({ archivePath, ...encrypted, upload }, null, 2));
    });
}
