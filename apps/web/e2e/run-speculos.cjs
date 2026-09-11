const { execFileSync, spawn } = require('node:child_process');
// Manual speculos start for interactive debugging (same args the fixture uses, no seed)
const { execSync } = require('child_process');
execSync('docker rm -f soulvault-dmk-speculos-browser', { stdio: 'ignore' }) ;
const child = require('child_process').spawn('docker', [
  'run', '--rm', '--name', 'soulvault-dmk-speculos-browser',
  '-p', '127.0.0.1:5000:5000',
  '-v', '/Users/pointcoexpedro/Dev/Web3/soulvault/packages/node/test/speculos/apps:/speculos/apps:ro',
  'ghcr.io/ledgerhq/speculos@sha256:6ed9eefd51cddd862b746719af4cd7a3265fe43d0588c388359753cab8d46d11',
  '--model', 'nanosp', '--display', 'headless', '--apdu-port', '9999', '--api-port', '5000',
  '/speculos/apps/nanosp-ethereum.elf',
], { stdio: 'inherit' });
process.on('SIGINT', () => { execSync('docker rm -f soulvault-dmk-speculos-browser', { stdio: 'ignore' }); process.exit(0); });
