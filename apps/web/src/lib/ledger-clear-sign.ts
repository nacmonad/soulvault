/**
 * Clear-signing context module for browser DMK sessions — the browser port of
 * packages/node/src/signer.ts buildLedgerSignerEth + wrapContextModuleClearSignAware.
 *
 * The context module fetches CAL descriptors from Ledger's descriptor service
 * (globalThis.fetch — browser-native) so the device renders decoded calldata,
 * trusted names, and EIP-712 fields instead of a blind "Data present" prompt.
 *
 * Browser semantics are always clear-sign-preferred: if descriptor fetching
 * fails (offline, unsupported selector, service error), we hand back zero
 * contexts so the kit's blind-signing fallback takes over instead of failing
 * the whole device action. Strict mode (fail instead of blind-sign) stays a
 * CLI-only affordance until the dashboard has a setting for it.
 */
import {
  ContextModuleBuilder,
  ContextModuleChainID,
  type ContextModule,
} from "@ledgerhq/context-module";
import type { DeviceManagementKit } from "@ledgerhq/device-management-kit";

export function createBrowserContextModule(dmk: DeviceManagementKit): ContextModule {
  const inner = new ContextModuleBuilder({
    loggerFactory: (tag: string) => dmk.getLoggerFactory()(["ContextModule", tag]),
  })
    .setChain(ContextModuleChainID.Ethereum)
    .build();

  // Proxy so every current and future ContextModule member is forwarded;
  // only getContexts is overridden (same shape as the CLI wrapper).
  return new Proxy(inner, {
    get(target, prop) {
      if (prop !== "getContexts") {
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return async (...args: Parameters<ContextModule["getContexts"]>) => {
        try {
          return await target.getContexts(...args);
        } catch (cause) {
          // Preferred mode: degrade to blind signing rather than blocking the tx.
          console.warn(
            "[ContextModule] clear-sign descriptor fetch failed; falling back to blind signing.",
            cause,
          );
          return [];
        }
      };
    },
  });
}
