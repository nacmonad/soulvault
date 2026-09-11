"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { DeviceActionStatus, DeviceManagementKitBuilder, UserInteractionRequired, type DeviceSessionId, type DeviceSessionState, type TransportFactory, type TransportIdentifier } from "@ledgerhq/device-management-kit";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { webHidIdentifier, webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, timeout } from "rxjs";
import { hexToBytes, isAddressEqual, keccak256, parseTransaction, type Address, type Hex } from "viem";
import type { SignerEth } from "@ledgerhq/device-signer-kit-ethereum";
import { getBrowserSoulVaultActivityConfig, loadSoulVaultActivity, type SoulVaultActivity } from "@/lib/onchain/soulvault-activity";
import { createBrowserContextModule } from "@/lib/ledger-clear-sign";
import { createLedgerTxChannel, type DeviceTransactionSignature } from "@/lib/ledger-tx";
import { describeTransaction, type TxSummary } from "@/lib/tx-decode";
import { errorMessage } from "@/lib/error-message";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import { sendWalletTransaction, serializedLedgerSignature, setTxChannel, signTypedData as signInjectedTypedData, type ChainSender } from "@/lib/wallet-tx";
import { createFoundryProvider } from "@/lib/foundry-provider";

/** What the dashboard shows while a Ledger signing prompt is up. */
export type DeviceSigningPrompt = {
  /** keccak hash of the unsigned payload — matches what the device displays. */
  hash: Hex;
  summary: TxSummary;
};

const DERIVATION_PATH = "44'/60'/0'/0/0";
const DISCOVERY_TIMEOUT_MS = 15_000;
/**
 * Device-action inactivity window (reset on every device-state emission), not a
 * wall-clock cap: a human reviewing/confirming screens on the device, with the
 * 3s session refresher interleaving APDUs, can legitimately take minutes on a
 * multi-screen blind-sign prompt. The action is only abandoned when the device
 * goes quiet for this long.
 */
const DEVICE_ACTION_TIMEOUT_MS = 120_000;
/**
 * Ceiling while the device is blocked on a user interaction (clear-signing
 * walk). DMK re-emits only on step/interaction changes, so the 30-40 screen
 * parameter walk emits nothing while the user presses — the extended window
 * keeps a healthy signing session alive for the whole walk.
 */
const SIGNING_CEILING_MS = 10 * 60 * 1000;
export type DevelopmentLedgerTransport = {
  factory: TransportFactory;
  identifier: TransportIdentifier;
  emulated: true;
};
type SoulVaultLedgerProviderProps = PropsWithChildren<{
  /** Test-only transport injection. Production builds reject this prop. */
  developmentLedgerTransport?: DevelopmentLedgerTransport;
}>;
export type LedgerConnectionStatus = "idle" | "connecting" | "connected" | "loading-activity" | "error";
export type SoulVaultWalletConnector = "ledger" | "browser-wallet";
type InjectedProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
type ContextValue = {
  address?: Address; activity: SoulVaultActivity[]; status: LedgerConnectionStatus;
  connector?: SoulVaultWalletConnector; deviceState?: DeviceSessionState; error?: string;
  /** Set while a device signing prompt is up — hash + decoded tx summary. */
  devicePrompt?: DeviceSigningPrompt;
  isBrowserWalletAvailable: boolean;
  connectLedger(): Promise<void>; connectBrowserWallet(): Promise<void>;
  disconnect(): Promise<void>; refreshActivity(): Promise<void>;
  sendTransaction: ChainSender;
  signTypedData(input: { address: Address; payload: string }): Promise<string>;
};
const LedgerContext = createContext<ContextValue | null>(null);

export function SoulVaultLedgerProvider({ children, developmentLedgerTransport }: SoulVaultLedgerProviderProps) {
  if (process.env.NODE_ENV === "production" && developmentLedgerTransport) {
    throw new Error("Development Ledger transports cannot be selected in production.");
  }
  const selectedTransport = process.env.NODE_ENV !== "production" && developmentLedgerTransport
    ? developmentLedgerTransport
    : { factory: webHidTransportFactory, identifier: webHidIdentifier, emulated: false as const };
  const dmk = useMemo(() => new DeviceManagementKitBuilder().addTransport(selectedTransport.factory).build(), [selectedTransport.factory]);
  const sessionRef = useRef<DeviceSessionId | undefined>(undefined);
  const signerRef = useRef<SignerEth | undefined>(undefined);
  const subscriptionRef = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const injectedRef = useRef<InjectedProvider | undefined>(undefined);
  const injectedListenersRef = useRef<Array<{ event: string; listener: (...args: unknown[]) => void }>>([]);
  const [address, setAddress] = useState<Address>();
  const [connector, setConnector] = useState<SoulVaultWalletConnector>();
  const [activity, setActivity] = useState<SoulVaultActivity[]>([]);
  const [status, setStatus] = useState<LedgerConnectionStatus>("idle");
  const [deviceState, setDeviceState] = useState<DeviceSessionState>();
  const [devicePrompt, setDevicePrompt] = useState<DeviceSigningPrompt>();
  const [error, setError] = useState<string>();
  // Browser-wallet detection must happen post-mount: it reads window.ethereum,
  // and computing it during render produces different SSR/client markup
  // (disabled attribute) → hydration mismatch. Detect on mount, not in render.
  const [isBrowserWalletAvailable, setBrowserWalletAvailable] = useState(false);
  useEffect(() => {
    setBrowserWalletAvailable(!!getInjectedProvider());
  }, []);

  const refreshForAddress = useCallback(async (wallet: Address) => {
    const config = getBrowserSoulVaultActivityConfig();
    if (!config) { setActivity([]); setStatus("connected"); return; }
    setStatus("loading-activity");
    setActivity(await loadSoulVaultActivity(wallet, config));
    setStatus("connected");
  }, []);

  const requireSigner = useCallback((): SignerEth => {
    const signer = signerRef.current;
    if (!signer) throw new Error("No Ledger session. Connect your Ledger first.");
    return signer;
  }, []);

  const ledgerSignTransaction = useCallback(async (unsignedSerialized: Hex): Promise<DeviceTransactionSignature> => {
    const unsignedHash = keccak256(unsignedSerialized);
    let summary: TxSummary;
    try {
      const parsed = parseTransaction(unsignedSerialized);
      summary = describeTransaction({ to: parsed.to ?? null, data: parsed.data ?? "0x", value: parsed.value });
    } catch {
      summary = { title: "Unknown transaction", lines: [] };
    }
    setDevicePrompt({ hash: unsignedHash, summary });
    try {
      return await runDeviceAction<DeviceTransactionSignature>(
        requireSigner().signTransaction(DERIVATION_PATH, hexToBytes(unsignedSerialized)),
      );
    } finally {
      setDevicePrompt(undefined);
    }
  }, []);

  const ledgerSignTypedData = useCallback(async (payload: string): Promise<string> => {
    const sig = await runDeviceAction<{ r: string; s: string; v: number }>(
      requireSigner().signTypedData(DERIVATION_PATH, JSON.parse(payload) as Parameters<SignerEth["signTypedData"]>[1]),
    );
    // Match the eth_signTypedData_v4 shape the browser channel returns: 65-byte
    // r||s||v hex. Device v is a single byte — normalize to 27/28 via parity.
    const yParity = Number(sig.v) & 1;
    return ("0x" + sig.r.slice(2) + sig.s.slice(2) + (27 + yParity).toString(16).padStart(2, "0")) as Hex;
  }, []);

  const disconnect = useCallback(async () => {
    subscriptionRef.current?.unsubscribe(); subscriptionRef.current = undefined;
    for (const { event, listener } of injectedListenersRef.current) injectedRef.current?.removeListener?.(event, listener);
    injectedListenersRef.current = []; injectedRef.current = undefined;
    const sessionId = sessionRef.current; sessionRef.current = undefined;
    if (sessionId) await dmk.disconnect({ sessionId }).catch(() => undefined);
    signerRef.current = undefined;
    setTxChannel(undefined);
    setDevicePrompt(undefined);
    setAddress(undefined); setConnector(undefined); setActivity([]); setDeviceState(undefined); setError(undefined); setStatus("idle");
  }, [dmk]);

  const connectLedger = useCallback(async () => {
    if (!dmk.isEnvironmentSupported()) { setStatus("error"); setError(selectedTransport.emulated ? "The development Ledger transport is unavailable." : "Ledger WebHID requires Chromium on HTTPS or localhost."); return; }
    await disconnect(); setStatus("connecting"); setError(undefined);
    try {
      const device = await firstValueFrom(dmk.startDiscovering({ transport: selectedTransport.identifier }).pipe(timeout(DISCOVERY_TIMEOUT_MS)));
      await dmk.stopDiscovering().catch(() => undefined);
      const sessionId = await dmk.connect({ device, sessionRefresherOptions: { isRefresherDisabled: false, pollingInterval: 3_000 } });
      sessionRef.current = sessionId;
      subscriptionRef.current = dmk.getDeviceSessionState({ sessionId }).subscribe({
        next: setDeviceState,
        // Without an error handler, an errored session-state observable (device
        // USB hiccup, polling failure mid-sign) rethrows globally as an
        // unhandled rejection — the DMK payload is a plain object, so it
        // renders as "[object Object]". Surface it in the provider instead.
        error: (cause) => {
          subscriptionRef.current = undefined;
          setStatus("error");
          setError(toUserMessage(cause));
        },
      });
      // Clear-sign CAL descriptors: the device renders decoded calldata +
      // EIP-712 fields; failures degrade to blind signing (preferred mode).
      const signer = new SignerEthBuilder({ dmk, sessionId })
        .withContextModule(createBrowserContextModule(dmk))
        .build();
      signerRef.current = signer;
      const account = await runDeviceAction<{ address: Address }>(signer.getAddress(DERIVATION_PATH, {
        checkOnDevice: true,
        skipOpenApp: selectedTransport.emulated,
      }));
      setAddress(account.address); setConnector("ledger"); setStatus("connected");
      // Swap the transaction channel: sign on device, broadcast raw to the RPC.
      const config = getBrowserSoulVaultClientConfig();
      if (config) {
        setTxChannel(createLedgerTxChannel({ signTransaction: ledgerSignTransaction, signTypedData: ledgerSignTypedData, config }));
      }
      await refreshForAddress(account.address);
    } catch (cause) {
      await dmk.stopDiscovering().catch(() => undefined);
      setStatus("error"); setError(toUserMessage(cause));
    }
  }, [disconnect, dmk, refreshForAddress, selectedTransport.emulated, selectedTransport.identifier, ledgerSignTransaction, ledgerSignTypedData]);

  const connectBrowserWallet = useCallback(async () => {
    const provider = getInjectedProvider();
    if (!provider) { setStatus("error"); setError("No injected browser wallet was found."); return; }
    await disconnect(); setStatus("connecting"); setError(undefined);
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as Address[];
      const wallet = accounts[0];
      if (!wallet) throw new Error("The browser wallet did not return an account.");
      injectedRef.current = provider;
      const accountsChanged = (...values: unknown[]) => {
        const next = (values[0] as Address[] | undefined)?.[0];
        if (!next) { void disconnect(); return; }
        setAddress(next);
        void refreshForAddress(next).catch((cause) => { setStatus("error"); setError(toUserMessage(cause)); });
      };
      const walletDisconnected = () => { void disconnect(); };
      provider.on?.("accountsChanged", accountsChanged);
      provider.on?.("disconnect", walletDisconnected);
      injectedListenersRef.current = [
        { event: "accountsChanged", listener: accountsChanged },
        { event: "disconnect", listener: walletDisconnected },
      ];
      setAddress(wallet); setConnector("browser-wallet"); setStatus("connected");
      await refreshForAddress(wallet);
    } catch (cause) { setStatus("error"); setError(toUserMessage(cause)); }
  }, [disconnect, refreshForAddress]);

  const refreshActivity = useCallback(async () => {
    if (!address) return;
    try { setError(undefined); await refreshForAddress(address); }
    catch (cause) { setStatus("error"); setError(toUserMessage(cause)); }
  }, [address, refreshForAddress]);

  const sendTransaction = useCallback<ChainSender>(async (input) => {
    if (!address) throw new Error("Connect a wallet to send a transaction.");
    if (!isAddressEqual(input.from, address)) throw new Error("Connected wallet does not match the sender.");
    if (connector === "ledger" && !getBrowserSoulVaultClientConfig()) {
      throw new Error("SoulVault RPC not configured — set NEXT_PUBLIC_SOULVAULT_RPC_URL (or the settings override) to sign transactions.");
    }
    // Both connectors ride the active transaction channel (setTxChannel swaps in
    // the Ledger channel at connect): one signer (context-module enabled), one
    // preflight with RPC fallbacks, one broadcast path. The former inline
    // Ledger path here built a second, bare signer and its own preflight —
    // divergent code that failed in ways the proven wizard channel never did.
    return sendWalletTransaction(input);
  }, [address, connector]);

  const signTypedData = useCallback(async (input: { address: Address; payload: string }) => {
    if (!address) throw new Error("Connect a wallet to sign.");
    if (!isAddressEqual(input.address, address)) throw new Error("Connected wallet does not match the signer.");
    if (connector === "browser-wallet") return signInjectedTypedData(input);
    if (connector !== "ledger") throw new Error("Connect Ledger or a browser wallet first.");
    const sessionId = sessionRef.current;
    if (!sessionId) throw new Error("Ledger session is not connected.");
    let parsed: { domain: unknown; types: unknown; primaryType: string; message: unknown };
    try {
      parsed = JSON.parse(input.payload) as typeof parsed;
    } catch {
      throw new Error("Typed data payload is incomplete.");
    }
    if (!parsed?.domain || !parsed.types || !parsed.primaryType || !parsed.message) {
      throw new Error("Typed data payload is incomplete.");
    }
    const signer = new SignerEthBuilder({ dmk, sessionId }).build();
    try {
      const signature = await runDeviceAction<{ r: string; s: string; v: number }>(
        signer.signTypedData(
          DERIVATION_PATH,
          {
            domain: parsed.domain,
            types: parsed.types,
            primaryType: parsed.primaryType,
            message: parsed.message,
          } as never,
          { skipOpenApp: selectedTransport.emulated },
        ),
      );
      return serializedLedgerSignature(signature);
    } catch (cause) {
      throw new Error(toUserMessage(cause));
    }
  }, [address, connector, dmk, selectedTransport.emulated]);

  useEffect(() => () => {
    subscriptionRef.current?.unsubscribe();
    const sessionId = sessionRef.current;
    if (sessionId) void dmk.disconnect({ sessionId }).catch(() => undefined);
    dmk.close();
  }, [dmk]);

  const value = useMemo(() => ({
    address, activity, status, connector, deviceState, devicePrompt, error,
    isBrowserWalletAvailable,
    connectLedger, connectBrowserWallet, disconnect, refreshActivity,
    sendTransaction, signTypedData,
  }), [address, activity, status, connector, deviceState, devicePrompt, error, isBrowserWalletAvailable, connectLedger, connectBrowserWallet, disconnect, refreshActivity, sendTransaction, signTypedData]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

function getInjectedProvider(): InjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as typeof window & { ethereum?: InjectedProvider & { isFoundry?: boolean } };
  if (
    process.env.NEXT_PUBLIC_SOULVAULT_FOUNDRY_PROVIDER === "1" &&
    process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL &&
    !w.ethereum?.isFoundry
  ) {
    w.ethereum = createFoundryProvider({
      rpcUrl: process.env.NEXT_PUBLIC_SOULVAULT_RPC_URL.split(",")[0]!.trim(),
      chainId: Number(process.env.NEXT_PUBLIC_SOULVAULT_CHAIN_ID ?? 11155111),
    });
  }
  return w.ethereum;
}

export function useSoulVaultWallet() {
  const value = useContext(LedgerContext);
  if (!value) throw new Error("useSoulVaultWallet must be used within SoulVaultLedgerProvider");
  return value;
}

/** Backward-compatible name for the first DMK-only integration pass. */
export const useSoulVaultLedger = useSoulVaultWallet;

function runDeviceAction<T>(action: { observable: { subscribe(observer: { next(state: { status: DeviceActionStatus; output?: T; error?: unknown }): void; error(error: unknown): void }): { unsubscribe(): void } }; cancel(): void }): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: number;
    let armedWindowMs = DEVICE_ACTION_TIMEOUT_MS;
    const arm = (windowMs: number) => {
      armedWindowMs = windowMs;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => finish(() => { action.cancel(); reject(new Error(`Ledger confirmation timed out (no device activity for ${Math.round(windowMs / 1000)}s).`)); }),
        windowMs,
      );
    };
    arm(DEVICE_ACTION_TIMEOUT_MS);
    const subscription = action.observable.subscribe({
      next(state) {
        const interaction =
          (state as { intermediateValue?: { requiredUserInteraction?: string } }).intermediateValue
            ?.requiredUserInteraction;
        // While the device is blocked on a user interaction (mid clear-signing
        // walk), each "Confirm parameter" press is invisible to the action
        // observable — DMK only re-emits on step/interaction *changes*, so a
        // long parameter walk produces zero emissions and looks identical to a
        // dead device. Use the extended ceiling for exactly that phase; the
        // short window still governs a genuinely quiet device.
        arm(interaction && interaction !== UserInteractionRequired.None ? SIGNING_CEILING_MS : DEVICE_ACTION_TIMEOUT_MS);
        if (state.status === DeviceActionStatus.Completed) finish(() => resolve(state.output as T));
        else if (state.status === DeviceActionStatus.Error) finish(() => reject(state.error));
        else if (state.status === DeviceActionStatus.Stopped) finish(() => reject(new Error("Action cancelled on device.")));
      },
      error(cause) { finish(() => reject(cause)); },
    });
    function finish(done: () => void) { if (settled) return; settled = true; window.clearTimeout(timer); subscription?.unsubscribe(); done(); }
  });
}

function toUserMessage(cause: unknown) {
  const e = cause as { _tag?: string; errorCode?: string; originalError?: { errorCode?: string }; message?: string };
  const code = e?.errorCode ?? e?.originalError?.errorCode;
  if (e?._tag === "RefusedByUserDAError" || code === "5501" || code === "6985") return "Action cancelled on device.";
  if (e?._tag === "DeviceLockedError" || code === "5515") return "Unlock your Ledger and try again.";
  if (code === "6807") return "Install the Ethereum app on your Ledger and try again.";
  if (e?._tag === "NoAccessibleDeviceError") return "No Ledger found, or browser USB access was denied.";
  return e?.message ?? errorMessage(cause);
}
