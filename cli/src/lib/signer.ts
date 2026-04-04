import { HDNodeWallet, JsonRpcProvider, Wallet } from 'ethers';
import { loadEnv } from './config.js';

export async function createProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_RPC_URL, env.SOULVAULT_CHAIN_ID);
}

export async function createSwarmProvider() {
  return createProvider();
}

export async function createSigner() {
  const env = loadEnv();
  const provider = await createProvider();

  switch (env.SOULVAULT_SIGNER_MODE) {
    case 'mnemonic':
      if (!env.SOULVAULT_MNEMONIC) {
        throw new Error('SOULVAULT_MNEMONIC is required when SOULVAULT_SIGNER_MODE=mnemonic');
      }
      return HDNodeWallet.fromPhrase(env.SOULVAULT_MNEMONIC, undefined, env.SOULVAULT_MNEMONIC_PATH).connect(provider);
    case 'private-key':
      if (!env.SOULVAULT_PRIVATE_KEY) {
        throw new Error('SOULVAULT_PRIVATE_KEY is required when SOULVAULT_SIGNER_MODE=private-key');
      }
      return new Wallet(env.SOULVAULT_PRIVATE_KEY, provider);
    case 'ledger':
      throw new Error('Ledger signer mode is not scaffolded yet. Use mnemonic or private-key for MVP.');
    default:
      throw new Error(`Unsupported signer mode: ${env.SOULVAULT_SIGNER_MODE satisfies never}`);
  }
}

export async function describeSigner() {
  const signer = await createSigner();
  return {
    address: signer.address,
    publicKey: signer.signingKey.publicKey,
  };
}

export async function getSignerPrivateKey() {
  const signer = await createSigner();
  return signer.privateKey;
}
