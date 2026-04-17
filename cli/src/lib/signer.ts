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
import {
  ClearSignError,
  apduToClearSignCode,
  type ClearSignMode,
  type SignTransactionOptions,
  type SignTypedDataOptions,
} from './clear-sign-modes.js';

/**
 * Ledger DMK / signer packages ship a broken ESM entry on Node (directory `export * from "./src"`).
 * CJS builds work; load them explicitly.
 */
const requireLedger = createRequire(import.meta.url);
const { ContextModuleBuilder } = requireLedger('@ledgerhq/context-module');
const { DeviceManagementKitBuilder } = requireLedger('@ledgerhq/device-management-kit');
const { SignerEthBuilder } = requireLedger('@ledgerhq/device-signer-kit-ethereum');
const { nodeHidIdentifier, nodeHidTransportFactory } = requireLedger('@ledgerhq/device-transport-kit-node-hid');

/** Speculos transport kit — only loaded when SOULVAULT_SPECULOS_API_URL is set. */
function loadSpeculosTransport(): { speculosTransportFactory: Function; speculosIdentifier: unknown } | undefined {
  try {
    return requireLedger('@ledgerhq/device-transport-kit-speculos');
  } catch {
    return undefined;
  }
}

const LEDGER_DISCOVERY_TIMEOUT_MS = 15_000;
const LEDGER_ACTION_TIMEOUT_MS = 30_000;

type SoftwareSigner = HDNodeWallet | Wallet;
export type SoulVaultSigner = SoftwareSigner | LedgerEthersSigner;
export { ClearSignError } from './clear-sign-modes.js';
export type {
  ClearSignMode,
  ClearSignErrorCode,
  SignTransactionOptions,
  SignTypedDataOptions,
} from './clear-sign-modes.js';

/** Public helper so commands can opt-in to strict mode without touching internals. */
export async function signTransactionWithMode(
  signer: SoulVaultSigner,
  tx: TransactionRequest,
  opts?: SignTransactionOptions,
): Promise<string> {
  if (signer instanceof LedgerEthersSigner) {
    return signer.signTransactionWithOptions(tx, opts);
  }
  return signer.signTransaction(tx);
}

/** Public helper for typed-data signing with per-call clear-sign strictness. */
export async function signTypedDataWithMode(
  signer: SoulVaultSigner,
  domain: Record<string, unknown>,
  types: Record<string, Array<{ name: string; type: string }>>,
  value: Record<string, unknown>,
  opts?: SignTypedDataOptions,
): Promise<string> {
  if (signer instanceof LedgerEthersSigner) {
    return signer.signTypedDataWithOptions(domain, types, value, opts);
  }
  // Software signers ignore clear-sign mode — there is no device.
  return (signer as unknown as { signTypedData: (d: typeof domain, t: typeof types, v: typeof value) => Promise<string> })
    .signTypedData(domain, types, value);
}

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

/**
 * AsyncLocalStorage-style per-call override for clear-sign mode. We thread the
 * override through the context-module wrapper without changing the ethers
 * AbstractSigner public surface. Set immediately before each ledger action.
 */
let pendingClearSignMode: ClearSignMode | undefined;

function withClearSignMode<T>(mode: ClearSignMode | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = pendingClearSignMode;
  pendingClearSignMode = mode;
  return fn().finally(() => {
    pendingClearSignMode = prev;
  });
}

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

  /**
   * Sign a transaction with optional per-call clear-sign mode override.
   * When `opts.clearSign` is provided, it wins over `SOULVAULT_LEDGER_CLEAR_SIGN_MODE`.
   */
  async signTransactionWithOptions(tx: TransactionRequest, opts?: SignTransactionOptions) {
    return withClearSignMode(opts?.clearSign, () => this.signTransaction(tx));
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

    try {
      const signature = await runLedgerAction<LedgerSignature>(
        this.ledgerClient.signerEth.signTransaction(this.derivationPath, getBytes(transaction.unsignedSerialized)),
      );
      transaction.signature = EthersSignature.from(signature);
      return transaction.serialized;
    } catch (err) {
      throw toClearSignError(err, 'signTransaction');
    }
  }

  override async signMessage(message: string | Uint8Array) {
    try {
      const signature = await runLedgerAction<LedgerSignature>(
        this.ledgerClient.signerEth.signMessage(this.derivationPath, message),
      );
      return EthersSignature.from(signature).serialized;
    } catch (err) {
      throw toClearSignError(err, 'signMessage');
    }
  }

  /**
   * EIP-712 typed-data signing. Delegates to the Ledger Ethereum app's
   * signEIP712Message path via the device-signer-kit. On Speculos + real
   * hardware the app displays field-by-field when a matching typed-data
   * filter descriptor is available; otherwise it falls back to blind prompt.
   */
  /**
   * EIP-712 typed-data signing. Delegates to the Ledger Ethereum app's typed-data
   * APDU path via `@ledgerhq/device-signer-kit-ethereum`. Prefer
   * `signTypedDataWithMode` for callers that need to set clear-sign strictness.
   */
  override async signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string> {
    try {
      const kit = this.ledgerClient.signerEth as unknown as {
        signTypedData: (path: string, data: unknown) => Parameters<typeof runLedgerAction>[0];
      };
      const payload = { domain, types, primaryType: inferPrimaryType(types), message: value };
      const signature = await runLedgerAction<LedgerSignature>(
        kit.signTypedData(this.derivationPath, payload) as Parameters<typeof runLedgerAction>[0],
      );
      return EthersSignature.from(signature).serialized;
    } catch (err) {
      throw toClearSignError(err, 'signTypedData');
    }
  }

  async signTypedDataWithOptions(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
    opts?: SignTypedDataOptions,
  ): Promise<string> {
    return withClearSignMode(opts?.clearSign, () => this.signTypedData(domain, types, value));
  }
}

function inferPrimaryType(types: Record<string, Array<{ name: string; type: string }>>): string {
  // Prefer any non-EIP712Domain type; callers typically pass exactly one besides the domain.
  const keys = Object.keys(types).filter((k) => k !== 'EIP712Domain');
  if (keys.length === 0) throw new Error('signTypedData: no primary type in `types`');
  return keys[0]!;
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
 * Mode-aware context-module wrapper (see docs/clear-signing-spec.md §2).
 *
 *   - blind-only           → return empty context for tx input, skipping CAL
 *   - clear-sign-preferred → try inner; on fetch failure, fall back to empty (blind)
 *   - strict-clear-sign    → try inner; on empty/failure throw ClearSignError('UNSUPPORTED_SELECTOR')
 *
 * Resolution order per call: pendingClearSignMode (set by withClearSignMode)
 * → env SOULVAULT_LEDGER_CLEAR_SIGN_MODE → default 'clear-sign-preferred'.
 */
function wrapContextModuleClearSignAware(inner: ContextModule): ContextModule {
  const envMode = (): ClearSignMode => {
    try {
      return loadEnv().SOULVAULT_LEDGER_CLEAR_SIGN_MODE;
    } catch {
      return 'clear-sign-preferred';
    }
  };
  const resolveMode = (): ClearSignMode => pendingClearSignMode ?? envMode();
  return {
    async getContexts(input: unknown, expectedTypes?: ClearSignContextType[]) {
      if (!isTransactionSubsetInput(input)) {
        return inner.getContexts(input, expectedTypes);
      }
      const mode = resolveMode();
      if (mode === 'blind-only') return [];
      try {
        const ctxs = await inner.getContexts(input, expectedTypes);
        const hasAny = Array.isArray(ctxs) && (ctxs as unknown[]).length > 0;
        if (!hasAny && mode === 'strict-clear-sign') {
          throw new ClearSignError(
            'UNSUPPORTED_SELECTOR',
            `Strict clear-sign requested but no CAL context available for this selector (to=${(input as { to?: string }).to}). Switch to 'clear-sign-preferred' or add a CAL descriptor.`,
          );
        }
        return ctxs;
      } catch (err) {
        if (err instanceof ClearSignError) throw err;
        if (mode === 'strict-clear-sign') {
          throw new ClearSignError(
            'CLEAR_SIGN_CONTEXT_FETCH_FAILED',
            `Failed to fetch CAL context in strict mode: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        // preferred → silent fallback to blind
        return [];
      }
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
  const contextModule = wrapContextModuleClearSignAware(innerModule);
  return new SignerEthBuilder({ dmk, sessionId }).withContextModule(contextModule).build();
}

/** Convert low-level errors into ClearSignError where we can identify them. */
function toClearSignError(err: unknown, op: string): Error {
  if (err instanceof ClearSignError) return err;
  const apdu = extractLedgerApduCode(err);
  const code = apduToClearSignCode(apdu);
  if (code) {
    const msg = err instanceof Error ? err.message : String(err);
    return new ClearSignError(code, `${op} failed (APDU ${apdu}): ${msg}`, { apduCode: apdu, cause: err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/timed out/i.test(msg)) {
    return new ClearSignError('TIMEOUT', `${op} timeout: ${msg}`, { cause: err });
  }
  return wrapLedgerCommunicationError(err);
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
  const speculosUrl = process.env.SOULVAULT_SPECULOS_API_URL;
  const useSpeculos = !!speculosUrl;
  const builder = new DeviceManagementKitBuilder();
  let transportIdentifier: unknown = nodeHidIdentifier;
  if (useSpeculos) {
    const mod = loadSpeculosTransport();
    if (!mod) {
      throw new Error(
        'SOULVAULT_SPECULOS_API_URL is set but @ledgerhq/device-transport-kit-speculos is not installed. Run `pnpm add -D @ledgerhq/device-transport-kit-speculos`.',
      );
    }
    builder.addTransport(mod.speculosTransportFactory(speculosUrl));
    transportIdentifier = mod.speculosIdentifier;
    // eslint-disable-next-line no-console
    console.log(`[soulvault] Using Speculos transport at ${speculosUrl}`);
  } else {
    builder.addTransport(nodeHidTransportFactory);
  }
  const dmk = builder.build();

  if (!dmk.isEnvironmentSupported()) {
    throw new Error('Ledger Node HID transport is not supported in this environment.');
  }

  let sessionId: DeviceSessionId | undefined;
  try {
    const device = await discoverLedgerDevice(dmk, transportIdentifier);
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

async function discoverLedgerDevice(dmk: DeviceManagementKit, transportId: unknown = nodeHidIdentifier): Promise<DiscoveredDevice> {
  return await new Promise((resolve, reject) => {
    const discovery = dmk.startDiscovering({ transport: transportId as typeof nodeHidIdentifier });
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
}, timeoutMs = LEDGER_ACTION_TIMEOUT_MS): Promise<T> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      subscription?.unsubscribe();
      action.cancel();
      reject(new Error(
        `Ledger action timed out after ${timeoutMs}ms. Unlock the device, open the Ethereum app, and retry.`,
      ));
    }, timeoutMs);

    let subscription: { unsubscribe(): void } | undefined;
    subscription = action.observable.subscribe({
      next: (state) => {
        if (state.status === 'completed') {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          subscription?.unsubscribe();
          resolve(state.output as T);
          return;
        }

        if (state.status === 'error') {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          subscription?.unsubscribe();
          action.cancel();
          reject(state.error ?? new Error('Ledger device action failed.'));
        }
      },
      error: (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
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
