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
    // Skip other-chain entries up front (one watcher per chain today) so their
    // deploy-block searches never run; multi-chain watchers are the extension point.
    resolveOrgEventSources(orgEnsName, { watcherChainId: chainId ?? undefined })
      .then(async (sources) => {
        if (cancelled || sources.length === 0) return;
        try {
          await addSources(sources);
        } catch (error) {
          console.warn(
            `[OrgEventSourcesBridge] failed to add event sources for ${orgEnsName}:`,
            error instanceof Error ? error.message : error,
          );
        }
      })
      .catch((error: unknown) => {
        // Malformed or missing org records — swarm/treasury events stay absent.
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
