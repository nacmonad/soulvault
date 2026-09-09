import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildTreasuryEntry,
  findTreasuryEntry,
  normalizeTreasuryProfile,
  upsertLocalTreasuryEntry,
  type TreasuryChainEntry,
  type TreasuryProfile,
} from './treasury.js';

// Treasury state lives in ~/.soulvault — point the paths module at a throwaway
// temp dir so upsert tests never touch real local state.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'soulvault-treasury-test-'));
vi.mock('./paths.js', () => ({
  resolveRepoRoot: () => process.cwd(),
  resolveCliStateDir: () => tempDir,
  resolveTreasuriesDir: () => tempDir,
  resolveTreasuryPath: (orgSlug: string) => path.join(tempDir, `${orgSlug}.json`),
  resolveConfigPath: (orgSlug: string) => path.join(tempDir, 'config.json'),
  resolveOrganizationsDir: () => path.join(tempDir, 'organizations'),
  resolveOrganizationPath: (nameOrSlug: string) => path.join(tempDir, 'organizations', `${nameOrSlug}.json`),
  resolveSwarmsDir: () => path.join(tempDir, 'swarms'),
  resolveSwarmPath: (nameOrSlug: string) => path.join(tempDir, 'swarms', `${nameOrSlug}.json`),
  resolveKeysDir: () => path.join(tempDir, 'keys'),
  resolveAgentProfilePath: () => path.join(tempDir, 'agent.json'),
}));

const SEPOLIA_ENTRY: TreasuryChainEntry = {
  chainId: 11155111,
  rpcUrl: 'https://sepolia.example',
  contractAddress: '0x315CaF1C715d87631172cF7Adf3730eed5383817',
  ownerAddress: '0x56C528C96D19bd88844fb608035f4c745f25287b',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ensBinding: { status: 'bound', coinType: 2147486655 },
};

const GALILEO_ENTRY: TreasuryChainEntry = {
  chainId: 16602,
  rpcUrl: 'https://evmrpc-testnet.0g.ai',
  contractAddress: '0x00f412c40620997D32933c8E03629cd8811Fd2e2',
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
};

const profile = (treasuries: TreasuryChainEntry[]): TreasuryProfile => ({
  organization: 'soulvault-demo',
  organizationEnsName: 'soulvault-demo.eth',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  treasuries,
});

describe('normalizeTreasuryProfile', () => {
  it('passes through the multi-entry shape', () => {
    const normalized = normalizeTreasuryProfile(profile([SEPOLIA_ENTRY, GALILEO_ENTRY]));
    expect(normalized?.treasuries).toHaveLength(2);
    expect(normalized?.organization).toBe('soulvault-demo');
  });

  it('migrates the legacy single-treasury shape into one entry', () => {
    const legacy = {
      organization: 'soulvault-demo',
      organizationEnsName: 'soulvault-demo.eth',
      chainId: 11155111,
      rpcUrl: 'https://sepolia.example',
      contractAddress: SEPOLIA_ENTRY.contractAddress,
      ownerAddress: SEPOLIA_ENTRY.ownerAddress,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      deployment: { txHash: '0xdead' },
      ensBinding: { status: 'bound', coinType: 2147486655 },
    };
    const normalized = normalizeTreasuryProfile(legacy);
    expect(normalized?.treasuries).toEqual([
      {
        chainId: 11155111,
        rpcUrl: 'https://sepolia.example',
        contractAddress: SEPOLIA_ENTRY.contractAddress,
        ownerAddress: SEPOLIA_ENTRY.ownerAddress,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
        deployment: { txHash: '0xdead' },
        ensBinding: { status: 'bound', coinType: 2147486655 },
      },
    ]);
    expect(normalized?.organizationEnsName).toBe('soulvault-demo.eth');
  });

  it('returns null for garbage and unrecognizable objects', () => {
    expect(normalizeTreasuryProfile(null)).toBeNull();
    expect(normalizeTreasuryProfile('nope')).toBeNull();
    expect(normalizeTreasuryProfile({ treasuries: 'nope', organization: 'x' })).toBeNull();
    expect(normalizeTreasuryProfile({ treasuries: [], organization: 42 })).toBeNull();
  });

  it('drops malformed entries but keeps valid ones', () => {
    const normalized = normalizeTreasuryProfile({
      organization: 'soulvault-demo',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      treasuries: [SEPOLIA_ENTRY, { chainId: '16602' }, null],
    });
    expect(normalized?.treasuries).toEqual([SEPOLIA_ENTRY]);
  });
});

describe('findTreasuryEntry', () => {
  it('finds the entry for an explicit chainId', () => {
    const state = profile([SEPOLIA_ENTRY, GALILEO_ENTRY]);
    expect(findTreasuryEntry(state, 16602)?.contractAddress).toBe(GALILEO_ENTRY.contractAddress);
    expect(findTreasuryEntry(state, 11155111)?.contractAddress).toBe(SEPOLIA_ENTRY.contractAddress);
    expect(findTreasuryEntry(state, 84532)).toBeUndefined();
    expect(findTreasuryEntry(null)).toBeUndefined();
  });
});

describe('upsertLocalTreasuryEntry', () => {
  it('creates a profile with one entry per chain, preserving other chains on upsert', async () => {
    await upsertLocalTreasuryEntry({
      organization: 'soulvault-demo',
      organizationEnsName: 'soulvault-demo.eth',
      entry: SEPOLIA_ENTRY,
    });
    const afterSepolia = await upsertLocalTreasuryEntry({
      organization: 'soulvault-demo',
      entry: GALILEO_ENTRY,
    });
    expect(afterSepolia.profile.treasuries.map((t) => t.chainId)).toEqual([16602, 11155111]);
    expect(afterSepolia.profile.organizationEnsName).toBe('soulvault-demo.eth');

    // Rebinding the same address inherits createdAt; other chains untouched.
    const rebound = await upsertLocalTreasuryEntry({
      organization: 'soulvault-demo',
      entry: { ...SEPOLIA_ENTRY, updatedAt: '2026-09-10T00:00:00.000Z', ownerAddress: undefined },
    });
    expect(rebound.entry.createdAt).toBe(SEPOLIA_ENTRY.createdAt);
    expect(rebound.profile.treasuries).toHaveLength(2);
    expect(rebound.profile.treasuries.find((t) => t.chainId === 16602)?.contractAddress).toBe(
      GALILEO_ENTRY.contractAddress,
    );

    // The file on disk is the merged multi-entry profile.
    const onDisk = JSON.parse(fs.readFileSync(path.join(tempDir, 'soulvault-demo.json'), 'utf8'));
    expect(onDisk.treasuries).toHaveLength(2);
  });
});

describe('buildTreasuryEntry', () => {
  it('stamps the entry from env when chainId/rpcUrl omitted', () => {
    const entry = buildTreasuryEntry({ contractAddress: SEPOLIA_ENTRY.contractAddress });
    expect(typeof entry.chainId).toBe('number');
    expect(typeof entry.rpcUrl).toBe('string');
    expect(entry.contractAddress).toBe(SEPOLIA_ENTRY.contractAddress);
    expect(entry.deployment).toBeUndefined();
    expect(entry.ensBinding).toBeUndefined();
  });
});
