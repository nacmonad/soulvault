"use client";

/**
 * OrgEventSourcesBridge — feeds the org's ENS-published swarms and treasuries
 * into the shared events watcher.
 *
 * The events provider sits above DashboardSelectionProvider in the tree (it
 * wraps the whole app), so it cannot read the org selection itself; this
 * bridge lives below the selection provider and pushes sources up whenever
 * the selected org changes. Renders nothing.
 *
 * Switching orgs uses replace semantics (see replaceOrgSources): the previous
 * org's swarm/treasury sources are unregistered and their events purged, so
 * the pipeline reflects exactly the selected org. Deselecting an org drops
 * the slice entirely.
 */
import { useEffect } from "react";

import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useSoulVaultEventsContext } from "@/context/SoulVaultEventsProvider";
import { resolveOrgEventSources } from "@/lib/ens-discovery";

export function OrgEventSourcesBridge() {
  const { selection } = useDashboardSelection();
  const { address } = useSoulVaultWallet();
  const { replaceOrgSources, chainId } = useSoulVaultEventsContext();
  const orgEnsName = selection.orgId;

  useEffect(() => {
    if (!orgEnsName) {
      // Deselection (org cleared or wallet disconnected) must not leave the
      // previous org's contracts watched — drop the org slice entirely.
      void replaceOrgSources([]).catch(() => undefined);
      return;
    }
    let cancelled = false;
    // Transient ENS/RPC failures must not permanently drop the org's contracts
    // from event discovery — retry a few times before giving up.
    const attempt = async (n: number): Promise<void> => {
      // Skip other-chain entries up front (one watcher per chain today) so their
      // deploy-block searches never run; multi-chain watchers are the extension point.
      const sources = await resolveOrgEventSources(orgEnsName, {
        watcherChainId: chainId ?? undefined,
        viewer: address ?? undefined,
      });
      if (cancelled) return;
      if (sources.length === 0) {
        if (n > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!cancelled) return attempt(n - 1);
        }
        // Records genuinely absent (or unreachable): still replace, so a switch
        // away from an org that HAD contracts doesn't leave them registered.
        await replaceOrgSources([]).catch(() => undefined);
        return;
      }
      try {
        await replaceOrgSources(sources);
      } catch (error) {
        if (n > 0 && !cancelled) {
          console.warn(
            `[OrgEventSourcesBridge] replacing event sources for ${orgEnsName} failed (${n} retries left), retrying:`,
            error instanceof Error ? error.message : error,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!cancelled) return attempt(n - 1);
        }
        console.warn(
          `[OrgEventSourcesBridge] failed to replace event sources for ${orgEnsName}:`,
          error instanceof Error ? error.message : error,
        );
        return;
      }
    };
    void attempt(2).catch((error: unknown) => {
      // Malformed or missing org records after retries — swarm/treasury events stay absent.
      console.warn(
        `[OrgEventSourcesBridge] could not resolve event sources for ${orgEnsName}:`,
        error instanceof Error ? error.message : error,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [orgEnsName, replaceOrgSources, chainId, address]);

  return null;
}
