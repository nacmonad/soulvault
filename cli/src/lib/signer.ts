import {
  AbstractSigner,
  getBytes,
  HDNodeWallet,
  JsonRpcProvider,
  Signature as EthersSignature,
  Transaction,
  type Provider,
  type TransactionRequest,
  Wallet,
} from 'ethers';
import { DeviceActionStatus, DeviceManagementKitBuilder, type DeviceManagementKit, type DeviceSessionId, type DiscoveredDevice } from '@ledgerhq/device-management-kit';
import { SignerEthBuilder, type Signature as LedgerSignature, type SignerEth } from '@ledgerhq/device-signer-kit-ethereum';
import { nodeHidIdentifier, nodeHidTransportFactory } from '@ledgerhq/device-transport-kit-node-hid';
import { loadEnv } from './config.js';

const LEDGER_DISCOVERY_TIMEOUT_MS = 15_000;

type SoftwareSigner = HDNodeWallet | Wallet;
export type SoulVaultSigner = SoftwareSigner | LedgerEthersSigner;

type LedgerClient = {
  dmk: DeviceManagementKit;
  sessionId: DeviceSessionId;
  signerEth: SignerEth;
  derivationPath: string;
  address: string;
  publicKey: string;
};

type LedgerAddressResponse = {
  address: `0x${string}`;
  publicKey: string;
};

let ledgerClientPromise: Promise<LedgerClient> | undefined;

class LedgerEthersSigner extends AbstractSigner {
  readonly address: string;
  readonly publicKey: string;
  readonly derivationPath: string;

  constructor(
    provider: Provider | null,
    private readonly ledgerClient: LedgerClient,
  ) {
    super(provider);
    this.address = ledgerClient.address;
    this.publicKey = ledgerClient.publicKey;
    this.derivationPath = ledgerClient.derivationPath;
  }

  override connect(provider: null | Provider): LedgerEthersSigner {
    return new LedgerEthersSigner(provider, this.ledgerClient);
  }

  override async getAddress() {
    return this.address;
  }

  override async signTransaction(tx: TransactionRequest) {
    const populated = await this.populateTransaction(tx);
    const transaction = Transaction.from(populated);
    const signature = await runLedgerAction<LedgerSignature>(
      this.ledgerClient.signerEth.signTransaction(this.derivationPath, getBytes(transaction.unsignedSerialized))
    );
    transaction.signature = EthersSignature.from(signature);
    return transaction.serialized;
  }

  override async signMessage(message: string | Uint8Array) {
    const signature = await runLedgerAction<LedgerSignature>(
      this.ledgerClient.signerEth.signMessage(this.derivationPath, message)
    );
    return EthersSignature.from(signature).serialized;
  }

  override async signTypedData(): Promise<string> {
    throw new Error('Ledger typed-data signing is not wired in SoulVault yet.');
  }
}

export async function createProvider() {
  const env = loadEnv();
  return new JsonRpcProvider(env.SOULVAULT_RPC_URL, env.SOULVAULT_CHAIN_ID);
}

export async function createSwarmProvider() {
  return createProvider();
}

export async function createSignerForProvider(provider: JsonRpcProvider): Promise<SoulVaultSigner> {
  const env = loadEnv();

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
      return createLedgerSigner(provider);
    default:
      throw new Error(`Unsupported signer mode: ${env.SOULVAULT_SIGNER_MODE satisfies never}`);
  }
}

export async function createSigner() {
  const provider = await createProvider();
  return createSignerForProvider(provider);
}

export async function describeSigner() {
  const signer = await createSigner();
  if (isLedgerSigner(signer)) {
    return {
      address: signer.address,
      publicKey: signer.publicKey,
    };
  }

  return {
    address: signer.address,
    publicKey: signer.signingKey.publicKey,
  };
}

export async function getSignerPrivateKey() {
  const env = loadEnv();
  if (env.SOULVAULT_SIGNER_MODE === 'ledger') {
    throw new Error('Ledger signer mode does not expose a private key. Use a software signer for local ECDH/decryption flows.');
  }

  const signer = await createSigner();
  if (isLedgerSigner(signer)) {
    throw new Error('Ledger signer mode does not expose a private key.');
  }
  return signer.privateKey;
}

function isLedgerSigner(signer: SoulVaultSigner): signer is LedgerEthersSigner {
  return signer instanceof LedgerEthersSigner;
}

async function createLedgerSigner(provider: JsonRpcProvider) {
  const ledgerClient = await getLedgerClient();
  return new LedgerEthersSigner(provider, ledgerClient);
}

async function getLedgerClient() {
  if (!ledgerClientPromise) {
    ledgerClientPromise = initializeLedgerClient().catch((error) => {
      ledgerClientPromise = undefined;
      throw error;
    });
  }

  return ledgerClientPromise;
}

async function initializeLedgerClient(): Promise<LedgerClient> {
  const env = loadEnv();
  const derivationPath = normalizeLedgerDerivationPath(env.SOULVAULT_LEDGER_DERIVATION_PATH);
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(nodeHidTransportFactory)
    .build();

  if (!dmk.isEnvironmentSupported()) {
    throw new Error('Ledger Node HID transport is not supported in this environment.');
  }

  let sessionId: DeviceSessionId | undefined;
  try {
    const device = await discoverLedgerDevice(dmk);
    sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });

    const signerEth = new SignerEthBuilder({ dmk, sessionId }).build();
    const account = await runLedgerAction<LedgerAddressResponse>(
      signerEth.getAddress(derivationPath, { checkOnDevice: false })
    );

    return {
      dmk,
      sessionId,
      signerEth,
      derivationPath,
      address: account.address,
      publicKey: toHexPrefixed(account.publicKey),
    };
  } catch (error) {
    if (sessionId) {
      await dmk.disconnect({ sessionId }).catch(() => undefined);
    }
    dmk.close();
    throw error;
  }
}

async function discoverLedgerDevice(dmk: DeviceManagementKit): Promise<DiscoveredDevice> {
  return await new Promise((resolve, reject) => {
    const discovery = dmk.startDiscovering({ transport: nodeHidIdentifier });
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`No Ledger device discovered within ${LEDGER_DISCOVERY_TIMEOUT_MS}ms. Unlock the device, open the Ethereum app, and retry.`));
    }, LEDGER_DISCOVERY_TIMEOUT_MS);

    let subscription: { unsubscribe(): void } | undefined;
    subscription = discovery.subscribe({
      next: (device) => {
        cleanup();
        resolve(device);
      },
      error: (error) => {
        cleanup();
        reject(error);
      },
    });

    function cleanup() {
      clearTimeout(timeout);
      subscription?.unsubscribe();
      void dmk.stopDiscovering().catch(() => undefined);
    }
  });
}

async function runLedgerAction<T>(action: {
  observable: {
    subscribe(observer: {
      next(state: { status: DeviceActionStatus; output?: T; error?: unknown }): void;
      error?(error: unknown): void;
    }): { unsubscribe(): void };
  };
  cancel: () => void;
}): Promise<T> {
  return await new Promise((resolve, reject) => {
    let subscription: { unsubscribe(): void } | undefined;
    subscription = action.observable.subscribe({
      next: (state) => {
        if (state.status === DeviceActionStatus.Completed) {
          subscription?.unsubscribe();
          resolve(state.output as T);
          return;
        }

        if (state.status === DeviceActionStatus.Error) {
          subscription?.unsubscribe();
          action.cancel();
          reject(state.error ?? new Error('Ledger device action failed.'));
        }
      },
      error: (error) => {
        subscription?.unsubscribe();
        action.cancel();
        reject(error);
      },
    });
  });
}

function normalizeLedgerDerivationPath(path: string) {
  return path.replace(/^m\//, '');
}

function toHexPrefixed(value: string) {
  return value.startsWith('0x') ? value : `0x${value}`;
}
