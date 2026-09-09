// Generates apps/web/src/lib/contracts-artifacts.ts from the forge artifacts.
// Run after `forge build` from the repo root: node scripts/generate-contract-artifacts.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  { name: 'TREASURY_ARTIFACT', artifact: 'out/SoulVaultTreasury.sol/SoulVaultTreasury.json' },
  { name: 'SWARM_ARTIFACT', artifact: 'out/SoulVaultSwarm.sol/SoulVaultSwarm.json' },
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
fs.writeFileSync(outFile, header + '\n' + body);
console.log(`Wrote ${outFile}`);
