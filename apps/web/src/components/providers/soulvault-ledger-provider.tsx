"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from "react";
import { DeviceActionStatus, DeviceManagementKitBuilder, type DeviceSessionId, type DeviceSessionState, type TransportFactory, type TransportIdentifier } from "@ledgerhq/device-management-kit";
import { SignerEthBuilder } from "@ledgerhq/device-signer-kit-ethereum";
import { webHidIdentifier, webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, timeout } from "rxjs";
import type { Address } from "viem";
import { getBrowserSoulVaultActivityConfig, loadSoulVaultActivity, type SoulVaultActivity } from "@/lib/onchain/soulvault-activity";

const DERIVATION_PATH = "44'/60'/0'/0/0";
const DISCOVERY_TIMEOUT_MS = 15_000;
const DEVICE_ACTION_TIMEOUT_MS = 60_000;
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
  isBrowserWalletAvailable: boolean;
  connectLedger(): Promise<void>; connectBrowserWallet(): Promise<void>;
  disconnect(): Promise<void>; refreshActivity(): Promise<void>;
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
  const subscriptionRef = useRef<{ unsubscribe(): void } | undefined>(undefined);
  const injectedRef = useRef<InjectedProvider | undefined>(undefined);
  const injectedListenersRef = useRef<Array<{ event: string; listener: (...args: unknown[]) => void }>>([]);
  const [address, setAddress] = useState<Address>();
  const [connector, setConnector] = useState<SoulVaultWalletConnector>();
  const [activity, setActivity] = useState<SoulVaultActivity[]>([]);
  const [status, setStatus] = useState<LedgerConnectionStatus>("idle");
  const [deviceState, setDeviceState] = useState<DeviceSessionState>();
  const [error, setError] = useState<string>();

  const refreshForAddress = useCallback(async (wallet: Address) => {
    const config = getBrowserSoulVaultActivityConfig();
    if (!config) { setActivity([]); setStatus("connected"); return; }
    setStatus("loading-activity");
    setActivity(await loadSoulVaultActivity(wallet, config));
    setStatus("connected");
  }, []);

  const disconnect = useCallback(async () => {
    subscriptionRef.current?.unsubscribe(); subscriptionRef.current = undefined;
    for (const { event, listener } of injectedListenersRef.current) injectedRef.current?.removeListener?.(event, listener);
    injectedListenersRef.current = []; injectedRef.current = undefined;
    const sessionId = sessionRef.current; sessionRef.current = undefined;
    if (sessionId) await dmk.disconnect({ sessionId }).catch(() => undefined);
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
      subscriptionRef.current = dmk.getDeviceSessionState({ sessionId }).subscribe(setDeviceState);
      const signer = new SignerEthBuilder({ dmk, sessionId }).build();
      const account = await runDeviceAction<{ address: Address }>(signer.getAddress(DERIVATION_PATH, {
        checkOnDevice: true,
        skipOpenApp: selectedTransport.emulated,
      }));
      setAddress(account.address); setConnector("ledger"); setStatus("connected");
      await refreshForAddress(account.address);
    } catch (cause) {
      await dmk.stopDiscovering().catch(() => undefined);
      setStatus("error"); setError(toUserMessage(cause));
    }
  }, [disconnect, dmk, refreshForAddress, selectedTransport.emulated, selectedTransport.identifier]);

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

  useEffect(() => () => {
    subscriptionRef.current?.unsubscribe();
    const sessionId = sessionRef.current;
    if (sessionId) void dmk.disconnect({ sessionId });
    dmk.close();
  }, [dmk]);

  const value = useMemo(() => ({
    address, activity, status, connector, deviceState, error,
    isBrowserWalletAvailable: typeof window !== "undefined" && !!getInjectedProvider(),
    connectLedger, connectBrowserWallet, disconnect, refreshActivity,
  }), [address, activity, status, connector, deviceState, error, connectLedger, connectBrowserWallet, disconnect, refreshActivity]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

function getInjectedProvider(): InjectedProvider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as typeof window & { ethereum?: InjectedProvider }).ethereum;
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
    const timer = window.setTimeout(() => finish(() => { action.cancel(); reject(new Error("Ledger confirmation timed out.")); }), DEVICE_ACTION_TIMEOUT_MS);
    const subscription = action.observable.subscribe({
      next(state) {
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
  return e?.message ?? "Could not connect to the Ledger.";
}
