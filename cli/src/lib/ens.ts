import { Contract, JsonRpcProvider } from 'ethers';
import { loadEnv } from './config.js';
import { createSignerForProvider } from './signer.js';

const ENS_REGISTRY_ABI = [
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)',
  'function setResolver(bytes32 node, address resolver)',
] as const;

const PUBLIC_RESOLVER_ABI = [
  'function setAddr(bytes32 node, address a)',
  'function setText(bytes32 node, string key, string value)',
  'function setName(bytes32 node, string newName)',
] as const;

const ETH_REGISTRAR_CONTROLLER_ABI = [
  'function available(string label) view returns (bool)',
  'function valid(string label) view returns (bool)',
  'function minCommitmentAge() view returns (uint256)',
  'function rentPrice(string label, uint256 duration) view returns ((uint256 base, uint256 premium) price)',
  'function makeCommitment((string label,address owner,uint256 duration,bytes32 secret,address resolver,bytes[] data,uint8 reverseRecord,bytes32 referrer) registration) pure returns (bytes32 commitment)',
  'function commit(bytes32 commitment)',
  'function register((string label,address owner,uint256 duration,bytes32 secret,address resolver,bytes[] data,uint8 reverseRecord,bytes32 referrer) registration) payable',
] as const;

export async function createEthProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_ETH_RPC_URL, env.SOULVAULT_ENS_CHAIN_ID);
}

export async function createEnsProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_ENS_RPC_URL, env.SOULVAULT_ENS_CHAIN_ID);
}

export async function createEnsSigner() {
  const provider = await createEnsProvider();
  return createSignerForProvider(provider);
}

export function getEnsContracts() {
  const env = loadEnv();
  return {
    registry: env.SOULVAULT_ENS_REGISTRY_ADDRESS,
    baseRegistrar: env.SOULVAULT_ENS_BASE_REGISTRAR_ADDRESS,
    controller: env.SOULVAULT_ENS_CONTROLLER_ADDRESS,
    publicResolver: env.SOULVAULT_ENS_PUBLIC_RESOLVER_ADDRESS,
    universalResolver: env.SOULVAULT_ENS_UNIVERSAL_RESOLVER_ADDRESS,
  };
}

export async function getEnsRegistry(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(getEnsContracts().registry, ENS_REGISTRY_ABI, runner);
}

export async function getPublicResolver(withSigner = false) {
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(getEnsContracts().publicResolver, PUBLIC_RESOLVER_ABI, runner);
}

export async function getEthRegistrarController(withSigner = false) {
  const env = loadEnv();
  const runner = withSigner ? await createEnsSigner() : await createEnsProvider();
  return new Contract(env.SOULVAULT_ENS_CONTROLLER_ADDRESS, ETH_REGISTRAR_CONTROLLER_ABI, runner);
}

export function getSoulVaultEnsTextRecordKeys() {
  return [
    'soulvault.swarmContract',
    'soulvault.chainId',
    'soulvault.publicManifestUri',
    'soulvault.publicManifestHash',
    'erc8004.registry',
    'erc8004.agentId',
  ] as const;
}
