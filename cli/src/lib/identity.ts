import { getAgentProfile } from './agent.js';

type ServiceInput = { type: string; url: string };

export function buildAgentRegistration(input: {
  name: string;
  description?: string;
  image?: string;
  harness?: string;
  backupCommand?: string;
  services?: ServiceInput[];
  swarmContract?: string;
  registryAddress?: string;
}) {
  const payload = {
    type: 'SoulVaultAgent',
    name: input.name,
    description: input.description ?? 'SoulVault agent identity',
    image: input.image,
    services: input.services ?? [],
    supportedTrust: ['erc8004', 'soulvault'],
    soulvault: {
      swarmContract: input.swarmContract,
      memberAddress: undefined as string | undefined,
      role: 'member-agent',
      harness: input.harness,
      backupHarnessCommand: input.backupCommand,
      registryAddress: input.registryAddress,
    }
  };

  return payload;
}

export async function renderAgentUri(input: {
  name?: string;
  description?: string;
  image?: string;
  services?: ServiceInput[];
  swarmContract?: string;
  registryAddress?: string;
}) {
  const profile = await getAgentProfile();
  if (!profile) {
    throw new Error('No local agent profile found. Run `soulvault agent create` first.');
  }

  const payload = buildAgentRegistration({
    name: input.name ?? profile.name,
    description: input.description,
    image: input.image,
    harness: profile.harness,
    backupCommand: profile.backupCommand,
    services: input.services,
    swarmContract: input.swarmContract,
    registryAddress: input.registryAddress,
  });

  payload.soulvault.memberAddress = profile.address;

  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, 'utf8').toString('base64');
  return {
    payload,
    agentURI: `data:application/json;base64,${encoded}`,
  };
}
