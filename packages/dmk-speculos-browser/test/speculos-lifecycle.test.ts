import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildSpeculosDockerArgs } from './speculos-lifecycle.js';

describe('Speculos lifecycle runner', () => {
  it('mounts only the external ELF directory and exposes the REST API locally', () => {
    const appElfPath = '/opt/ledger-apps/nanosp-ethereum.elf';

    expect(buildSpeculosDockerArgs({
      appElfPath,
      image: 'ghcr.io/ledgerhq/speculos@sha256:fixture',
      containerName: 'fixture-speculos',
    })).toEqual([
      'run', '--rm', '--name', 'fixture-speculos',
      '-p', '127.0.0.1:5000:5000',
      '-v', `${resolve('/opt/ledger-apps')}:/speculos/apps:ro`,
      'ghcr.io/ledgerhq/speculos@sha256:fixture',
      '--model', 'nanosp',
      '--display', 'headless',
      '--apdu-port', '9999',
      '--api-port', '5000',
      '/speculos/apps/nanosp-ethereum.elf',
    ]);
  });
});
