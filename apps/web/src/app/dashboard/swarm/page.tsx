"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddressEqual, type Address } from "viem";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { SwarmWizard } from "@/components/create/swarm-wizard";
import { publicClientForChainId } from "@/lib/chains";
import { reduceSwarmState, type SwarmState } from "@/lib/onchain/reducers";
import { approveJoin, rejectJoin } from "@/lib/treasury-contract";
import { shortAddress, shortTx, explorerTxUrl } from "@/lib/format";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { AgentIdentityCard, type EacRolesResolver } from "@/components/dashboard/agent-identity-card";
import { EacDelegationPanel } from "@/components/dashboard/eac-delegation-panel";
import { resolveNameEacContext, readNameEacRoles } from "@/lib/ensv2-eac";
import { getBrowserSoulVaultClientConfig, createSoulVaultPublicClient } from "@/lib/onchain/client";

type SwarmListItem = {
  id: string;
  label: string;
  ensName: string;
  address: Address | null;
  chainId: number | null;
  source: "ens";
};

const OWNER_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export default function SwarmPage() {
  const { address } = useSoulVaultWallet();
  const { selection, setSwarm } = useDashboardSelection();
  const { events, status, error, refresh, sources } = useSwarmEvents({ live: true, pollSeconds: 5 });
  const discovery = useOrgDiscovery(selection.orgId);

  const [busy, setBusy] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  /** Last completed wallet action, for the ✓ banner (null until one lands). */
  const [lastTx, setLastTx] = useState<{ label: string; txHash: string; chainId: number } | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  /** Owner read keyed to the swarm it was read from (stale reads never apply). */
  const [ownerRead, setOwnerRead] = useState<{ swarm: Address; owner: Address | null } | null>(null);

  /** Swarms published on the org's ENS soulvault.swarms record. */
  const items = useMemo<SwarmListItem[]>(
    () =>
      (discovery.swarms ?? []).map((entry) => ({
        id: entry.label,
        label: entry.label,
        ensName: entry.ensName,
        address: entry.address,
        chainId: entry.chainId,
        source: "ens" as const,
      })),
    [discovery.swarms],
  );

  /** The swarm whose state + join actions this page renders. */
  const current = useMemo(
    () => items.find((item) => item.id === selection.swarmId) ?? null,
    [items, selection.swarmId],
  );

  // Single-swarm orgs shouldn't need an explicit click to scope the page.
  useEffect(() => {
    if (discovery.status === "ready" && items.length === 1 && selection.swarmId === null) {
      setSwarm(items[0].id);
    }
  }, [discovery.status, items, selection.swarmId, setSwarm]);

  /** Per-swarm pending join counts for the 1:M org:swarm list badges. */
  const pendingBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (!item.address) continue;
      const scoped = events.filter(
        (event) => event.sourceKind === "swarm" && isAddressEqual(event.source, item.address as Address),
      );
      counts.set(item.address.toLowerCase(), reduceSwarmState(scoped).pendingJoins.size);
    }
    return counts;
  }, [items, events]);

  const globalState = useMemo(() => reduceSwarmState(events), [events]);

  /**
   * ERC-8004 identities for member enrichment, keyed by wallet. Matched by
   * WALLET, not by URI attribution: registrations made before the swarm was
   * deployed carry an empty or stale soulvault.swarmContract (seen live:
   * agent #4 attributed to a previous swarm, #3 to none) — excluding those
   * would hide identities for members whose wallet is provably in the swarm.
   * A stale attribution is surfaced as a row warning instead (MemberRow).
   */
  const { agentProfiles } = useAgentEvents({ live: true, pollSeconds: 15 });
  const agentsByWallet = useMemo(() => {
    const map = new Map<string, typeof agentProfiles>();
    for (const profile of agentProfiles) {
      const key = profile.wallet.toLowerCase();
      const list = map.get(key) ?? [];
      list.push(profile);
      map.set(key, list);
    }
    // Highest agentId first — the latest registration wins the row header.
    for (const list of map.values()) list.sort((a, b) => (a.agentId >= b.agentId ? -1 : 1));
    return map;
  }, [agentProfiles]);

  /**
   * ENSv2 EAC role reader for identity cards: the roles each wallet holds on
   * the selected swarm's name resource (ops.<org>.eth). Cached per wallet —
   * roles only change on a grant/revoke tx, so a session-long memo is honest.
   */
  const resolveRoles = useMemo<EacRolesResolver | undefined>(() => {
    if (!current?.ensName) return undefined;
    const config = getBrowserSoulVaultClientConfig();
    if (!config) return undefined;
    const client = createSoulVaultPublicClient(config);
    const cache = new Map<string, Promise<bigint | null>>();
    return (wallet: Address) => {
      const key = wallet.toLowerCase();
      let promise = cache.get(key);
      if (!promise) {
        promise = resolveNameEacContext({ fullName: current.ensName, viewer: wallet, client })
          .then((ctx) =>
            ctx ? readNameEacRoles({ ctx, client, account: wallet }).then((r) => r.bitmap) : null,
          )
          .catch(() => null);
        cache.set(key, promise);
      }
      return promise;
    };
  }, [current?.ensName]);

  /**
   * State scoped to the selected swarm's contract (events can span 1:M swarm
   * contracts — without the source filter, requests from sibling swarms mix in).
   * Falls back to the aggregated state when nothing is selected.
   */
  const scopedState: SwarmState | null = useMemo(() => {
    if (!current?.address) return null;
    const scoped = events.filter(
      (event) => event.sourceKind === "swarm" && isAddressEqual(event.source, current.address as Address),
    );
    return reduceSwarmState(scoped);
  }, [current, events]);

  const view = scopedState ?? globalState;

  // Owner read for the selected swarm: join approve/reject is owner-only, and
  // the actions stay hidden for non-owners (same pattern as the treasury page).
  useEffect(() => {
    if (!current?.address || current.chainId === null) return;
    const target = current.address;
    const client = publicClientForChainId(current.chainId);
    if (!client) return;
    let cancelled = false;
    client
      .readContract({
        address: target,
        abi: OWNER_ABI,
        functionName: "owner",
      })
      .then((owner) => {
        if (!cancelled) setOwnerRead({ swarm: target, owner });
      })
      .catch(() => {
        // Read failure (RPC hiccup) — actions stay hidden rather than broken.
        if (!cancelled) setOwnerRead({ swarm: target, owner: null });
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  if (!address) return null;

  const owner =
    ownerRead !== null && current?.address != null && isAddressEqual(ownerRead.swarm, current.address)
      ? ownerRead.owner
      : null;
  const isOwner = owner !== null && isAddressEqual(owner, address);
  const members = [...view.members.values()];
  const pending = [...view.pendingJoins.values()];
  const empty = status === "ready" && members.length === 0 && pending.length === 0 && view.currentEpoch === null;
  const canManage = scopedState !== null && current?.address !== null && isOwner;

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setTxError(null);
    try {
      const result = await fn();
      if (typeof result === "string" && result.startsWith("0x")) {
        setLastTx({
          label: key.startsWith("approve") ? "Join request approved" : key.startsWith("reject") ? "Join request rejected" : key,
          txHash: result,
          chainId: current?.chainId ?? 0,
        });
      }
      await refresh();
    } catch (error) {
      setTxError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="eyebrow text-primary">Swarm</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Membership and epoch</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Reduced from swarm + treasury events. Select a swarm below to review and
        approve or reject its pending join requests.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="xs" variant="outline" disabled={status === "loading"} onClick={() => void refresh()}>
          {status === "loading" ? "Scanning…" : "Rescan"}
        </Button>
        {error instanceof Error ? <span className="text-sm text-destructive">{error.message}</span> : null}
        <span className="text-xs text-muted-foreground">
          {sources.length === 0
            ? "no event sources discovered yet — select an org"
            : `watching ${sources.length} contract${sources.length === 1 ? "" : "s"} (${sources
                .map((s) => s.label ?? s.kind)
                .join(", ")}) · ${events.length} swarm/treasury event${events.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {items.length > 0 ? (
        <ul className="mt-6 border border-border">
          {items.map((item) => {
            const isCurrent = selection.swarmId === item.id;
            const pendingCount = item.address ? (pendingBySource.get(item.address.toLowerCase()) ?? 0) : 0;
            return (
              <li key={`${item.source}:${item.id}`} className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
                <button
                  type="button"
                  className={`font-mono text-sm ${isCurrent ? "text-primary" : ""}`}
                  onClick={() => setSwarm(item.id)}
                >
                  {item.label}
                </button>
                {item.address ? (
                  <CopyableAddress address={item.address} chainId={item.chainId} />
                ) : null}
                {item.chainId !== null ? (
                  <span className="font-mono text-xs text-muted-foreground">chain {item.chainId}</span>
                ) : null}
                <span className="text-xs text-muted-foreground">via {item.source}</span>
                {pendingCount > 0 ? (
                  <span className="chip text-primary">
                    {pendingCount} join request{pendingCount === 1 ? "" : "s"}
                  </span>
                ) : null}
                {isCurrent ? <span className="chip text-primary">current</span> : null}
              </li>
            );
          })}
        </ul>
      ) : discovery.status === "loading" ? (
        <p className="mt-6 text-sm text-muted-foreground">Reading the org&apos;s ENS swarm list…</p>
      ) : (
        <p className="mt-6 text-sm text-muted-foreground">
          No swarms published on the org&apos;s ENS <span className="font-mono">soulvault.swarms</span>{" "}
          record. Create one below.
        </p>
      )}

      {items.length > 0 && !selection.swarmId ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Select a swarm above — with multiple swarms per org, state and join actions
          are scoped to the selected contract.
        </p>
      ) : null}

      {empty ? (
        <p className="mt-8 text-sm text-muted-foreground">No swarm events yet.</p>
      ) : (
        <>
          <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-2">
            <Field label="Epoch" value={view.currentEpoch !== null ? view.currentEpoch.toString() : "—"} />
            <Field
              label="Membership version"
              value={view.membershipVersion !== null ? view.membershipVersion.toString() : "—"}
            />
            <Field label="Treasury" value={view.treasury ? shortAddress(view.treasury) : "—"} mono />
            <Field label="Members" value={String(members.length)} />
          </dl>

          <h2 className="mt-8 text-sm font-semibold">Members</h2>
          {members.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No members in reduced state.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {members.map((member) => (
                <MemberRow key={member.wallet} member={member} agents={agentsByWallet.get(member.wallet.toLowerCase()) ?? []} swarmLabel={current?.label ?? null} resolveRoles={resolveRoles} />
              ))}
            </ul>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Pending joins
              {current ? <span className="ml-2 text-xs font-normal text-muted-foreground">on {current.label}</span> : null}
            </h2>
            {pending.length > 0 && current ? (
              <input
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="rejection reason"
                className="h-8 min-w-48 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
              />
            ) : null}
          </div>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="mt-2 border border-border">
              {pending.map((request) => (
                <li
                  key={request.requestId.toString()}
                  className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 font-mono text-sm last:border-b-0"
                >
                  <span>{shortAddress(request.requester)}</span>
                  <span className="text-muted-foreground">#{request.requestId.toString()}</span>
                  {canManage ? (
                    <span className="ml-auto flex gap-2">
                      <Button
                        size="xs"
                        disabled={busy !== null}
                        onClick={() =>
                          current?.address &&
                          void run(`approve-${request.requestId.toString()}`, async () => {
                            await approveJoin({
                              from: address,
                              swarm: current.address as Address,
                              requestId: request.requestId,
                              ...(current.chainId !== null ? { chainId: current.chainId } : {}),
                            });
                          })
                        }
                      >
                        {busy === `approve-${request.requestId.toString()}` ? "…" : "Approve"}
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() =>
                          current?.address &&
                          void run(`reject-${request.requestId.toString()}`, async () => {
                            await rejectJoin({
                              from: address,
                              swarm: current.address as Address,
                              requestId: request.requestId,
                              reason: rejectReason.trim() || "no reason given",
                              ...(current.chainId !== null ? { chainId: current.chainId } : {}),
                            });
                          })
                        }
                      >
                        {busy === `reject-${request.requestId.toString()}` ? "…" : "Reject"}
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {pending.length > 0 && current && !isOwner ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Only the swarm contract owner can approve or reject join requests.
            </p>
          ) : null}
          {txError ? <p className="mt-2 text-sm text-destructive">{txError}</p> : null}
          {lastTx ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
              <span className="font-medium">✓ {lastTx.label}</span>
              <span className="font-mono text-xs text-muted-foreground">{shortTx(lastTx.txHash)}</span>
              {explorerTxUrl(lastTx.txHash, lastTx.chainId) ? (
                <a
                  className="text-xs underline decoration-dotted"
                  href={explorerTxUrl(lastTx.txHash, lastTx.chainId) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on explorer ↗
                </a>
              ) : null}
              <Button variant="outline" size="xs" className="ml-auto" onClick={() => setLastTx(null)}>
                Dismiss
              </Button>
            </div>
          ) : null}
        </>
      )}

      {current ? <EacDelegationPanel swarmEnsName={current.ensName} /> : null}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button disabled variant="outline" size="sm">
          Fund requests <span className="chip ml-2">soon</span>
        </Button>
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Create swarm</summary>
          {selection.orgId ? (
            <SwarmWizard orgEnsName={selection.orgId} />
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Select an organization first — the swarm binds an ENS subdomain under the
              org name and is appended to the org&apos;s swarm list.
            </p>
          )}
        </details>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card p-5">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className={`mt-2 text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

type MemberRowMember = {
  wallet: Address;
  joinedEpoch: bigint;
};

type MemberRowAgent = {
  agentId: bigint;
  wallet: Address;
  uri: string | null;
  swarmContract: Address | null;
};

/**
 * One member row: wallet + join epoch, enriched with whatever the member's
 * ERC-8004 registration carries (via the shared AgentIdentityCard). Identity
 * data is additive — a wallet with no registration shows the plain row.
 */
function MemberRow({ member, agents, swarmLabel, resolveRoles }: { member: MemberRowMember; agents: MemberRowAgent[]; swarmLabel: string | null; resolveRoles?: EacRolesResolver }) {
  const identity = agents[0] ?? null;
  return (
    <li className="border-b border-border px-4 py-2 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-sm">{shortAddress(member.wallet)}</span>
        <span className="font-mono text-xs text-muted-foreground">epoch {member.joinedEpoch.toString()}</span>
      </div>
      {identity ? (
        <div className="mt-1">
          <AgentIdentityCard
            agentId={identity.agentId}
            wallet={identity.wallet}
            uri={identity.uri}
            compareWallet={member.wallet}
            swarmName={identity.swarmContract && swarmLabel ? swarmLabel : null}
            resolveRoles={resolveRoles}
          />
        </div>
      ) : null}
    </li>
  );
}
