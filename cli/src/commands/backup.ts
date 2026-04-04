import path from 'node:path';
import { Command } from 'commander';
import { createWorkspaceArchive, encryptArchiveWithEpochKey } from '../lib/backup.js';
import { uploadPreparedArtifact } from '../lib/0g.js';
import { writeLastBackup } from '../lib/state.js';

export function registerBackupCommands(program: Command) {
  const backup = program
    .command('backup')
    .description('Member-side backup: archive workspace, encrypt with current K_epoch, upload to 0G (not the onchain backup trigger — use `swarm backup-request` for that)');

  backup
    .command('push')
    .description('Create encrypted backup artifact and upload; updates ~/.soulvault/last-backup.json')
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
      const rootHash = upload.rootHash ?? upload.rootHashes?.[0];
      const txHash = upload.txHash ?? upload.txHashes?.[0];
      const record = {
        createdAt: new Date().toISOString(),
        workspace,
        archivePath,
        encryptedPath: encrypted.encryptedPath,
        manifest: encrypted.manifest,
        upload,
        rootHash,
        txHash,
      };
      await writeLastBackup(record);
      console.log(JSON.stringify(record, null, 2));
    });
}
