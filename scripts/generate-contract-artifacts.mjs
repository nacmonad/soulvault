// Generates apps/web/src/lib/contracts-artifacts.ts from the forge artifacts.
// Run after `forge build` from the repo root: node scripts/generate-contract-artifacts.mjs
// `--check` mode: exit 1 if the committed file differs from what would be
// generated (guards against shipping a stale artifact after a contract change).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const check = process.argv.includes('--check');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  { name: 'TREASURY_ARTIFACT', artifact: 'out/SoulVaultTreasury.sol/SoulVaultTreasury.json' },
  { name: 'SWARM_ARTIFACT', artifact: 'out/SoulVaultSwarm.sol/SoulVaultSwarm.json' },
  { name: 'DOCUMENT_REGISTRY_ARTIFACT', artifact: 'out/SoulVaultDocumentRegistry.sol/SoulVaultDocumentRegistry.json' },
];

const header = `// AUTO-GENERATED from forge artifacts — do not edit by hand.
// Regenerate: forge build && node scripts/generate-contract-artifacts.mjs
`;

const body = targets
  .map(({ name, artifact }) => {
    const full = path.join(repoRoot, artifact);
    if (!fs.existsSync(full)) {
      console.error(`Missing artifact: ${artifact}. Run \`forge build\` first.`);
      process.exit(1);
    }
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
    const bytecode = typeof parsed.bytecode === 'string' ? parsed.bytecode : parsed.bytecode.object;
    if (!bytecode || bytecode === '0x') {
      console.error(`Artifact ${artifact} has empty bytecode — is it a stub/interface?`);
      process.exit(1);
    }
    return `export const ${name} = ${JSON.stringify({ abi: parsed.abi, bytecode })} as const;\n`;
  })
  .join('\n');

const outFile = path.join(repoRoot, 'apps/web/src/lib/contracts-artifacts.ts');
const content = header + '\n' + body;
if (check) {
  const current = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
  if (current !== content) {
    console.error(
      'apps/web/src/lib/contracts-artifacts.ts is out of sync with the forge artifacts.\n' +
        'Regenerate from the repo root: forge build && node scripts/generate-contract-artifacts.mjs',
    );
    process.exit(1);
  }
  console.log('contracts-artifacts.ts is in sync with the forge artifacts.');
} else {
  fs.writeFileSync(outFile, content);
  console.log(`Wrote ${outFile}`);
}
