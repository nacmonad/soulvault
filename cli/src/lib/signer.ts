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
import { createRequire } from 'node:module';
import type { ClearSignContextType, ContextModule } from '@ledgerhq/context-module';
import type { DeviceManagementKit, DeviceSessionId, DiscoveredDevice } from '@ledgerhq/device-management-kit';
import type { Signature as LedgerSignature, SignerEth } from '@ledgerhq/device-signer-kit-ethereum';
import { loadEnv } from './config.js';

/**
 * Ledger DMK / signer packages ship a broken ESM entry on Node (directory `export * from "./src"`).
 * CJS builds work; load them explicitly.
 */
const requireLedger = createRequire(import.meta.url);
const { ContextModuleBuilder } = requireLedger('@ledgerhq/context-module');
const { DeviceManagementKitBuilder } = requireLedger('@ledgerhq/device-management-kit');
const { SignerEthBuilder } = requireLedger('@ledgerhq/device-signer-kit-ethereum');
const { nodeHidIdentifier, nodeHidTransportFactory } = requireLedger('@ledgerhq/device-transport-kit-node-hid');

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
    // populateTransaction sets `from`; ethers v6 rejects unsigned txs that still define `from`.
    const { from: _dropFrom, ...unsigned } = populated;
    let transaction = Transaction.from(unsigned);

    // Ledger Ethereum app frequently returns 6a80 "Invalid data" on EIP-1559 / EIP-2930 serialized
    // payloads from `unsignedSerialized`. Rebuild as legacy type-0 with a single gasPrice for signing.
    if ((transaction.type === 1 || transaction.type === 2) && this.provider) {
      const fd = await this.provider.getFeeData();
      const gasPrice =
        fd.gasPrice ?? fd.maxFeePerGas ?? transaction.maxFeePerGas ?? transaction.gasPrice ?? null;
      if (gasPrice == null || gasPrice === 0n) {
        throw new Error(
          'Ledger signing needs a legacy gasPrice; network fee data was empty. Wait and retry or use a different RPC.',
        );
      }
      transaction = Transaction.from({
        type: 0,
        chainId: transaction.chainId,
        nonce: transaction.nonce,
        gasLimit: transaction.gasLimit,
        gasPrice,
        to: transaction.to,
        value: transaction.value,
        data: transaction.data,
      });
    }

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

export async function describeSigner(options?: { skipLedgerAutoSync?: boolean }) {
  const signer = await createSigner();
  const env = loadEnv();
  const out = isLedgerSigner(signer)
    ? { address: signer.address, publicKey: signer.publicKey }
    : { address: signer.address, publicKey: signer.signingKey.publicKey };

  const shouldAutoSync =
    !options?.skipLedgerAutoSync &&
    env.SOULVAULT_SIGNER_MODE === 'ledger' &&
    env.SOULVAULT_LEDGER_AUTO_SYNC;

  if (shouldAutoSync) {
    const { maybeLedgerAutoSync } = await import('./ledger-sync.js');
    try {
      await maybeLedgerAutoSync(out.address);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[soulvault] ledger auto-sync failed: ${msg}`);
    }
  }

  return out;
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

/** Subset shape from Ledger ETH mapper (chainId + contract `to`) when fetching clear-sign contexts. */
function isTransactionSubsetInput(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const o = input as Record<string, unknown>;
  return typeof o.chainId === 'number' && typeof o.to === 'string';
}

/**
 * Default `@ledgerhq/context-module` tries to push clear-sign CAL payloads for many contract calls.
 * Unsupported selectors (e.g. ENS commit) make the device report "cannot be clear-signed" / 6a80
 * before blind signing runs. Returning no contexts skips those APDUs so signing uses the generic path.
 */
function wrapContextModuleSkipTxClearSign(inner: ContextModule): ContextModule {
  return {
    async getContexts(input: unknown, expectedTypes?: ClearSignContextType[]) {
      if (isTransactionSubsetInput(input)) {
        return [];
      }
      return inner.getContexts(input, expectedTypes);
    },
    getFieldContext(field, expectedType) {
      return inner.getFieldContext(field, expectedType);
    },
    getTypedDataFilters(typedData) {
      return inner.getTypedDataFilters(typedData);
    },
    getSolanaContext(tx) {
      return inner.getSolanaContext(tx);
    },
  };
}

function buildLedgerSignerEth(dmk: DeviceManagementKit, sessionId: DeviceSessionId) {
  const innerModule = new ContextModuleBuilder({
    originToken: undefined,
    loggerFactory: (tag: string) => dmk.getLoggerFactory()(['ContextModule', tag]),
  }).build();
  const contextModule = wrapContextModuleSkipTxClearSign(innerModule);
  return new SignerEthBuilder({ dmk, sessionId }).withContextModule(contextModule).build();
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
    const connectedSessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    sessionId = connectedSessionId;

    const signerEth = buildLedgerSignerEth(dmk, connectedSessionId);
    const checkOnDevice = env.SOULVAULT_LEDGER_CONFIRM_ADDRESS;
    const account = await runLedgerAction<LedgerAddressResponse>(
      signerEth.getAddress(derivationPath, {
        checkOnDevice,
        // When verifying on-device, the app APDU includes chainId; align with identity lane (Sepolia).
        ...(checkOnDevice ? { chainId: env.SOULVAULT_ENS_CHAIN_ID } : {}),
      })
    );
    if (!account.address) {
      throw new Error('Ledger getAddress did not return an address');
    }
    if (!account.publicKey) {
      throw new Error('Ledger getAddress did not return a public key');
    }

    return {
      dmk,
      sessionId: connectedSessionId,
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
    throw wrapLedgerCommunicationError(error);
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

/** DMK string statuses (avoid importing enum — ESM re-exports can miss it on some runtimes). */
type LedgerDeviceActionStatus = 'not-started' | 'pending' | 'stopped' | 'completed' | 'error';

async function runLedgerAction<T>(action: {
  observable: {
    subscribe(observer: {
      next(state: { status: LedgerDeviceActionStatus; output?: T; error?: unknown }): void;
      error?(error: unknown): void;
    }): { unsubscribe(): void };
  };
  cancel: () => void;
}): Promise<T> {
  return await new Promise((resolve, reject) => {
    let subscription: { unsubscribe(): void } | undefined;
    subscription = action.observable.subscribe({
      next: (state) => {
        if (state.status === 'completed') {
          subscription?.unsubscribe();
          resolve(state.output as T);
          return;
        }

        if (state.status === 'error') {
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
  const trimmed = path.trim().replace(/^["']|["']$/g, '');
  return trimmed.replace(/^m\//, '');
}

function extractLedgerApduCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const o = err as Record<string, unknown>;
  if (typeof o.errorCode === 'string') return o.errorCode;
  const orig = o.originalError;
  if (typeof orig === 'object' && orig !== null && 'errorCode' in orig) {
    const c = (orig as { errorCode?: unknown }).errorCode;
    return typeof c === 'string' ? c : undefined;
  }
  return undefined;
}

/** Turn low-level DMK / APDU failures into actionable messages. */
function wrapLedgerCommunicationError(error: unknown): Error {
  if (typeof error !== 'object' || error === null) {
    return new Error(String(error));
  }

  const code = extractLedgerApduCode(error);
  const msg = error instanceof Error ? error.message : JSON.stringify(error);
  const tag =
    '_tag' in error && error._tag !== undefined ? String(error._tag as unknown) : '';

  const hints = [
    'Unlock the device and open the Ethereum app, then retry (stay on the app home / dashboard inside Ethereum).',
    'Quit Ledger Live and any other wallet that might be using the device over USB.',
    'Update device firmware and the Ethereum app in Ledger Live.',
    'Use a direct USB port (not an unpowered hub); try another cable.',
    'If `SOULVAULT_LEDGER_DERIVATION_PATH` is non-default, confirm it matches "44\'/60\'/…" (CLI strips the leading `m/`).',
  ].join('\n');

  const isExchangeFailure =
    code === '6a87' ||
    code === '6a80' ||
    msg.includes('6a87') ||
    msg.includes('6a80') ||
    msg.includes('UnknownDeviceExchangeError') ||
    tag === 'UnknownDeviceExchangeError';

  if (isExchangeFailure) {
    return new Error(
      `Ledger communication failed (APDU/status ${code ?? 'unknown'}). This often means the Ethereum app and CLI disagree on a command, or the device was not ready.\n\n${hints}\n\nOriginal: ${msg}`,
    );
  }

  return error instanceof Error ? error : new Error(msg);
}

function toHexPrefixed(value: string) {
  return value.startsWith('0x') ? value : `0x${value}`;
}
