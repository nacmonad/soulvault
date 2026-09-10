"use client";

/**
 * OrgEventSourcesBridge — feeds the org's ENS-published swarms and treasuries
 * into the shared events watcher.
 *
 * The events provider sits above DashboardSelectionProvider in the tree (it
 * wraps the whole app), so it cannot read the org selection itself; this
 * bridge lives below the selection provider and pushes sources up whenever
 * the selected org changes. Renders nothing.
 */
import { useEffect } from "react";

import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultEventsContext } from "@/context/SoulVaultEventsProvider";
import { resolveOrgEventSources } from "@/lib/ens-discovery";

export function OrgEventSourcesBridge() {
  const { selection } = useDashboardSelection();
  const { addSources, chainId } = useSoulVaultEventsContext();
  const orgEnsName = selection.orgId;

  useEffect(() => {
    if (!orgEnsName) return;
    let cancelled = false;
    // Transient ENS/RPC failures must not permanently drop the org's contracts
    // from event discovery — retry a few times before giving up.
    const attempt = async (n: number): Promise<void> => {
      // Skip other-chain entries up front (one watcher per chain today) so their
      // deploy-block searches never run; multi-chain watchers are the extension point.
      const sources = await resolveOrgEventSources(orgEnsName, { watcherChainId: chainId ?? undefined });
      if (cancelled) return;
      if (sources.length === 0) {
        if (n > 0) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!cancelled) return attempt(n - 1);
        }
        return;
      }
      try {
        const added = await addSources(sources);
        if (!added && sources.length > 0) return;
      } catch (error) {
        if (n > 0 && !cancelled) {
          console.warn(
            `[OrgEventSourcesBridge] adding event sources for ${orgEnsName} failed (${n} retries left), retrying:`,
            error instanceof Error ? error.message : error,
          );
          await new Promise((resolve) => setTimeout(resolve, 2000));
          if (!cancelled) return attempt(n - 1);
        }
        console.warn(
          `[OrgEventSourcesBridge] failed to add event sources for ${orgEnsName}:`,
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
  }, [orgEnsName, addSources, chainId]);

  return null;
}
