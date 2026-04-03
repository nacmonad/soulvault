import { loadEnv } from './config.js';
import { resolveBackupCommand } from './harness.js';
import { describeSigner } from './signer.js';
import { readAgentProfile, writeAgentProfile, writeConfig } from './state.js';

export type AgentProfile = {
  name: string;
  address: string;
  publicKey: string;
  harness: string;
  backupCommand: string;
  createdAt: string;
  runtime: 'openclaw' | 'unknown' | string;
};

export async function createOrLoadAgentProfile(input: Partial<Pick<AgentProfile, 'name' | 'harness' | 'backupCommand'>> = {}) {
  const existing = await readAgentProfile<AgentProfile>();
  if (existing) return existing;

  const env = loadEnv();
  const signer = await describeSigner();
  const harness = input.harness ?? env.SOULVAULT_DEFAULT_HARNESS;
  const backupCommand = resolveBackupCommand(harness, input.backupCommand ?? env.SOULVAULT_DEFAULT_BACKUP_COMMAND);

  const profile: AgentProfile = {
    name: input.name ?? 'RustyBot',
    address: signer.address,
    publicKey: signer.publicKey,
    harness,
    backupCommand,
    createdAt: new Date().toISOString(),
    runtime: harness === 'openclaw' ? 'openclaw' : 'unknown'
  };

  await writeAgentProfile(profile);
  await writeConfig({
    activeAddress: profile.address,
    harness: profile.harness,
    backupCommand: profile.backupCommand,
    rpcUrl: env.SOULVAULT_RPC_URL,
    chainId: env.SOULVAULT_CHAIN_ID,
    indexerUrl: env.SOULVAULT_0G_INDEXER_URL,
    signerMode: env.SOULVAULT_SIGNER_MODE,
  });

  return profile;
}

export async function getAgentProfile() {
  return readAgentProfile<AgentProfile>();
}
