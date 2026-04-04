import crypto from 'node:crypto';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import { Command } from 'commander';
import { decryptArchiveWithEpochKey } from '../lib/restore.js';
import { downloadFrom0G } from '../lib/0g.js';
import { readLastBackup } from '../lib/state.js';

type LastBackupRecord = {
  encryptedPath: string;
  archivePath: string;
  workspace?: string;
  rootHash?: string;
  manifest: {
    nonce: string;
    aad: string;
    authTag: string;
  };
};

const DEFAULT_COMPARE_PATHS = [
  'SOUL.md',
  'USER.md',
  'AGENTS.md',
  'memory/2026-04-03.md',
  'package.json',
  'tsconfig.json',
  'src/index.ts',
  'src/commands/identity.ts',
  'src/lib/0g.ts',
];

function sha256Hex(input: Buffer) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

async function extractArchive(archivePath: string, targetDir: string) {
  await fs.ensureDir(targetDir);
  await tar.extract({ file: archivePath, cwd: targetDir, gzip: true });
}

async function buildFileCompareReport(sourceWorkspace: string | undefined, extractedDir: string) {
  if (!sourceWorkspace) {
    return { comparedFiles: [], note: 'No workspace path recorded in last backup record.' };
  }

  const reports = [] as Array<{
    path: string;
    sourceExists: boolean;
    restoredExists: boolean;
    matches: boolean;
    sourceSha256?: string;
    restoredSha256?: string;
  }>;

  for (const relativePath of DEFAULT_COMPARE_PATHS) {
    const sourcePath = path.join(sourceWorkspace, relativePath);
    const restoredPath = path.join(extractedDir, relativePath);
    const sourceExists = await fs.pathExists(sourcePath);
    const restoredExists = await fs.pathExists(restoredPath);

    if (!sourceExists && !restoredExists) continue;

    let sourceSha256: string | undefined;
    let restoredSha256: string | undefined;
    let matches = false;

    if (sourceExists && restoredExists) {
      const [sourceStat, restoredStat] = await Promise.all([fs.stat(sourcePath), fs.stat(restoredPath)]);
      if (sourceStat.isFile() && restoredStat.isFile()) {
        const [sourceBytes, restoredBytes] = await Promise.all([fs.readFile(sourcePath), fs.readFile(restoredPath)]);
        sourceSha256 = sha256Hex(sourceBytes);
        restoredSha256 = sha256Hex(restoredBytes);
        matches = sourceSha256 === restoredSha256;
      }
    }

    reports.push({
      path: relativePath,
      sourceExists,
      restoredExists,
      matches,
      sourceSha256,
      restoredSha256,
    });
  }

  return {
    comparedFiles: reports,
    matchedCount: reports.filter((entry) => entry.matches).length,
    mismatchedCount: reports.filter((entry) => entry.sourceExists && entry.restoredExists && !entry.matches).length,
    missingCount: reports.filter((entry) => entry.sourceExists !== entry.restoredExists).length,
  };
}

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

  restore
    .command('verify-latest')
    .option('--root-hash <hash>', 'Override root hash to fetch from 0G')
    .option('--skip-download', 'Use local encrypted artifact from last backup record', false)
    .action(async (options) => {
      const last = await readLastBackup<LastBackupRecord>();
      if (!last) throw new Error('No last-backup.json found. Run backup push first.');

      const tempDir = path.join(os.tmpdir(), 'soulvault-verify');
      await fs.ensureDir(tempDir);

      const encryptedPath = options.skipDownload
        ? last.encryptedPath
        : path.join(tempDir, `download-${Date.now()}.enc`);

      if (!options.skipDownload) {
        const rootHash = options.rootHash ?? last.rootHash;
        if (!rootHash) throw new Error('No root hash available. Provide --root-hash or run backup push without --skip-upload.');
        await downloadFrom0G(rootHash, encryptedPath);
      }

      const restoredArchivePath = path.join(tempDir, `restored-${Date.now()}.tar.gz`);
      await decryptArchiveWithEpochKey({
        encryptedPath,
        nonceHex: last.manifest.nonce,
        aad: last.manifest.aad,
        authTagHex: last.manifest.authTag,
        outputPath: restoredArchivePath,
      });

      const extractedDir = path.join(tempDir, `extracted-${Date.now()}`);
      await extractArchive(restoredArchivePath, extractedDir);

      const [expectedArchive, restoredArchive, fileCompare] = await Promise.all([
        fs.readFile(last.archivePath),
        fs.readFile(restoredArchivePath),
        buildFileCompareReport(last.workspace, extractedDir),
      ]);

      const expectedSha256 = sha256Hex(expectedArchive);
      const restoredSha256 = sha256Hex(restoredArchive);
      const matches = expectedSha256 === restoredSha256;

      console.log(JSON.stringify({
        verifiedAt: new Date().toISOString(),
        expectedArchive: last.archivePath,
        restoredArchive: restoredArchivePath,
        extractedDir,
        encryptedSource: encryptedPath,
        expectedSha256,
        restoredSha256,
        matches,
        fileCompare,
      }, null, 2));
    });
}
