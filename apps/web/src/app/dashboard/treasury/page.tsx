"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, type Address } from "viem";

import { Button } from "@/components/ui/button";
import { CopyableAddress } from "@/components/dashboard/copyable-address";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { TreasuryWizard } from "@/components/create/treasury-wizard";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { publicClientForChainId } from "@/lib/chains";
import type { OrgTreasuryEntry } from "@/lib/ens-writes";
import {
  approveFundRequest,
  cancelFundRequest,
  depositToTreasury,
  parseEthAmount,
  rejectFundRequest,
  requestFunds,
  withdrawFromTreasury,
} from "@/lib/treasury-contract";
import { shortAddress, shortTx, explorerTxUrl } from "@/lib/format";

const OWNER_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const STATUS_LABELS: Record<string, string> = {
  requested: "pending",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  "rejected-by-treasury": "rejected",
  released: "paid",
};

/** Human label per `run()` action key, for the completion banner. */
const ACTION_LABELS: Record<string, string> = {
  approve: "Fund request approved — funds released in the same transaction",
  reject: "Fund request rejected",
  deposit: "Deposit confirmed",
  withdraw: "Withdrawal confirmed",
  request: "Fund request submitted",
  cancel: "Fund request cancelled",
};

/** Per-org selected treasury, persisted so a reload keeps the choice. */
function treasurySelectionStorageKey(orgEnsName: string | null): string | null {
  return orgEnsName ? `soulvault.treasurySelection.${orgEnsName}` : null;
}

function treasuryKey(entry: { chainId: number; address: string }): string {
  return `${entry.chainId}:${entry.address.toLowerCase()}`;
}

export default function TreasuryPage() {
  const { address } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const swarm = useSwarmEvents({ live: true });
  const discovery = useOrgDiscovery(selection.orgId);

  const [balance, setBalance] = useState<bigint | null>(null);
  const [owner, setOwner] = useState<Address | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** Last completed wallet action, for the ✓ banner (null until one lands). */
  const [lastTx, setLastTx] = useState<{ label: string; txHash: string; chainId: number } | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  /** Selected treasury as `${chainId}:${address}` — the org may publish several
   * (ENSIP-11 slot per chain); flows below target the selection explicitly. */
  const [selectedTreasuryKey, setSelectedTreasuryKey] = useState<string | null>(null);

  // Restore the per-org selection (default: first published treasury).
  const storageKey = treasurySelectionStorageKey(selection.orgId);
  useEffect(() => {
    setSelectedTreasuryKey(null);
    if (!storageKey) return;
    try {
      const saved = window.localStorage.getItem(storageKey);
      if (saved) setSelectedTreasuryKey(saved);
    } catch {
      // localStorage unavailable — fall back to the first entry.
    }
  }, [storageKey]);

  const selectTreasury = useCallback(
    (key: string) => {
      setSelectedTreasuryKey(key);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, key);
        } catch {
          // non-fatal
        }
      }
    },
    [storageKey],
  );

  /**
   * Active treasury: the org's selected treasury from the ENS
   * `soulvault.treasuries` record (defaults to the first published). Flows
   * target this address explicitly.
   */
  const active = useMemo(() => {
    const entries = discovery.treasuries ?? [];
    if (entries.length === 0) return null;
    const selected = selectedTreasuryKey
      ? entries.find((entry) => treasuryKey(entry) === selectedTreasuryKey)
      : undefined;
    const entry = selected ?? entries[0];
    return {
      address: getAddress(entry.address),
      chainId: entry.chainId,
      label: entry.label ?? shortAddress(entry.address),
      source: "ens" as const,
    };
  }, [discovery.treasuries, selectedTreasuryKey]);

  /** The swarm bound to this treasury (fund approve/reject go through it):
   * first ENS-published swarm with a resolvable contract address. */
  const ensSwarm = useMemo(
    () =>
      discovery.swarms?.find(
        (entry): entry is typeof entry & { address: Address; chainId: number } =>
          entry.address !== null && entry.chainId !== null,
      ) ?? null,
    [discovery.swarms],
  );

  // Balance + owner reads go to the active treasury's own chain (it may live on
  // any deployment chain; ENS coordination stays on Sepolia).
  const publicClient = useMemo(
    () => (active ? publicClientForChainId(active.chainId) : null),
    [active?.address, active?.chainId],
  );

  const refreshOnchain = useCallback(async () => {
    if (!publicClient || !active) return;
    try {
      const [bal, treasOwner] = await Promise.all([
        publicClient.getBalance({ address: active.address }),
        publicClient.readContract({
          address: active.address,
          abi: OWNER_ABI,
          functionName: "owner",
        }),
      ]);
      setBalance(bal);
      setOwner(treasOwner);
    } catch {
      setBalance(null);
      setOwner(null);
    }
  }, [publicClient, active]);

  useEffect(() => {
    if (!address) return;
    const timer = setTimeout(() => void refreshOnchain(), 0);
    return () => clearTimeout(timer);
  }, [address, refreshOnchain]);

  if (!address) return null;

  if (!active) {
    const loading = discovery.status === "loading";
    return (
      <div>
        <p className="eyebrow text-primary">Treasury</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">No treasury published</h1>
        {selection.orgId ? (
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Nothing on the org&apos;s ENS <span className="font-mono">soulvault.treasuries</span> record
            {" "}({selection.orgId}) yet{loading ? " — checking…" : ""}. Deploy one below: it publishes
            the ENSIP-11 record for you, and this page becomes a live summary.
          </p>
        ) : (
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Select an organization first — the treasury is org-scoped and its ENSIP-11
            record needs the org ENS name.
          </p>
        )}
        {txError ? <p className="mt-3 text-sm text-destructive">{txError}</p> : null}
        {selection.orgId && !loading ? <TreasuryWizard orgEnsName={selection.orgId} /> : null}
      </div>
    );
  }

  const requests = [...swarm.fundRequests.values()].sort((a, b) =>
    a.requestId > b.requestId ? -1 : 1,
  );
  const pendingCount = requests.filter((request) => request.status === "requested").length;
  const isOwner = owner !== null && owner.toLowerCase() === address.toLowerCase();
  /** The watcher may not scan the active treasury's chain (one watcher per chain). */
  const activeChainWatched = swarm.chainId === null || swarm.chainId === active.chainId;
  const swarmSourceWatched = swarm.sources.some((source) => source.kind === "swarm");

  async function run(key: string, action: () => Promise<string>) {
    setTxError(null);
    setBusy(key);
    try {
      const txHash = await action();
      setLastTx({ label: ACTION_LABELS[key] ?? key, txHash, chainId: active?.chainId ?? 0 });
      await new Promise((resolve) => setTimeout(resolve, 3000));
      void refreshOnchain();
    } catch (error) {
      setTxError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="eyebrow text-primary">Treasury</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{active.label}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Resolved from the org ENS soulvault.treasuries record ({selection.orgId}).{" "}
        Org-scoped custody for native value. Payouts follow the story08 loop: a member
        requests, the owner approves or rejects, funds move in the approval transaction.
        A paid-out request is final — no revoke.
      </p>
      {txError ? <p className="mt-3 text-sm text-destructive">{txError}</p> : null}
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

      {pendingCount > 0 ? (
        <div className="mt-4 border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
          <span className="font-medium">
            {pendingCount} pending fund request{pendingCount === 1 ? "" : "s"}
          </span>{" "}
          awaiting action below{isOwner ? " — approve to release funds in the same transaction." : ""}
        </div>
      ) : null}

      <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-3">
        <Stat label="Balance" value={balance !== null ? `${formatEther(balance)} ETH` : "…"} mono />
        <Stat label="Owner" value={owner ? shortAddress(owner) : "…"} mono />
        <Stat label="Chain" value={String(active.chainId)} mono />
      </dl>
      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{active.address}</span>
        <CopyableAddress address={active.address} chainId={active.chainId} />
      </div>

      {!activeChainWatched ? (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          This treasury is on chain {active.chainId} but the event watcher scans chain{" "}
          {swarm.chainId ?? "?"} — its events (deposits, releases) will not appear in the
          dashboard event feed. Balances still read per-chain.
        </p>
      ) : null}

      <OrgTreasuriesSection
        orgEnsName={selection.orgId}
        discovery={discovery}
        activeAddress={active.address}
        watcherChainId={swarm.chainId}
        onSelect={(entry) => selectTreasury(treasuryKey(entry))}
      />

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Deposit</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Any wallet can fund — the funder and the approver can be different people.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!depositAmount.trim()) return;
            void run("deposit", () =>
              depositToTreasury({
                from: address,
                amountWei: parseEthAmount(depositAmount),
                treasury: active.address,
              }),
            );
          }}
        >
          <input
            value={depositAmount}
            onChange={(event) => setDepositAmount(event.target.value)}
            placeholder="0.1"
            className="h-8 w-32 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
            aria-label="Deposit amount in ETH"
          />
          <span className="text-xs text-muted-foreground">ETH</span>
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === "deposit" ? "Sending…" : "Deposit"}
          </Button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Fund requests</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Approval moves funds and emits the same-tx pair{" "}
          <span className="font-mono">FundRequestApproved → FundsReleased</span>.
        </p>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No fund requests yet.
            {!swarmSourceWatched ? (
              <>
                {" "}
                <span className="text-amber-600 dark:text-amber-400">
                  Note: no swarm contract is registered on the event watcher (chain{" "}
                  {swarm.chainId ?? "?"}), so swarm events — including FundRequested — cannot be
                  scanned. Check the org&apos;s ENS <span className="font-mono">soulvault.swarms</span>{" "}
                  record and the Events page pipeline panel.
                </span>
              </>
            ) : null}
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto border border-border">
            <table className="w-full min-w-176 text-left text-sm">
              <thead className="border-b border-border bg-card text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Requester</th>
                  <th className="px-3 py-2 font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Reason</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.requestId.toString()} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono text-xs">{request.requestId.toString()}</td>
                    <td className="px-3 py-2 font-mono text-xs">{shortAddress(request.requester)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{formatEther(request.amount)}</td>
                    <td className="px-3 py-2 text-muted-foreground">{request.reason ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`chip ${request.status === "requested" ? "text-primary" : "text-muted-foreground"}`}
                      >
                        {STATUS_LABELS[request.status] ?? request.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {request.status === "requested" && isOwner ? (
                          <Button
                            size="xs"
                            disabled={busy !== null || ensSwarm === null}
                            onClick={() =>
                              ensSwarm &&
                              void run("approve", () =>
                                approveFundRequest({
                                  from: address,
                                  swarm: ensSwarm.address,
                                  requestId: request.requestId,
                                  treasury: active.address,
                                }),
                              )
                            }
                          >
                            {busy === "approve" ? "…" : "Approve"}
                          </Button>
                        ) : null}
                        {request.status === "requested" && isOwner ? (
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={busy !== null || ensSwarm === null}
                            onClick={() =>
                              ensSwarm &&
                              void run("reject", () =>
                                rejectFundRequest({
                                  from: address,
                                  swarm: ensSwarm.address,
                                  requestId: request.requestId,
                                  reason: rejectReason.trim() || "no reason given",
                                  treasury: active.address,
                                }),
                              )
                            }
                          >
                            Reject
                          </Button>
                        ) : null}
                        {request.status === "requested" &&
                        request.requester.toLowerCase() === address.toLowerCase() ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() =>
                              void run(
                                `cancel-${request.requestId.toString()}`,
                                () =>
                                  cancelFundRequest({
                                    from: address,
                                    requestId: request.requestId,
                                    swarm: ensSwarm?.address,
                                  }),
                              )
                            }
                          >
                            Cancel
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {requests.some((request) => request.status === "requested") && isOwner ? (
          <input
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            placeholder="rejection reason (optional)"
            className="mt-3 h-8 min-w-56 border border-border bg-card px-2 font-mono text-xs outline-none focus:border-ring"
            aria-label="Rejection reason"
          />
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Request funds</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Caller must be an active swarm member. The contract checks membership, treasury
          binding, and amount &gt; 0.
        </p>
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!requestAmount.trim()) return;
            void run("request", () => {
              if (!ensSwarm) {
                throw new Error(
                  "No swarm target — the org's ENS soulvault.swarms record has no swarm with a resolvable address.",
                );
              }
              return requestFunds({
                from: address,
                amountWei: parseEthAmount(requestAmount),
                reason: requestReason.trim() || "fund request",
                swarm: ensSwarm.address,
              });
            });
          }}
        >
          <input
            value={requestAmount}
            onChange={(event) => setRequestAmount(event.target.value)}
            placeholder="0.05"
            className="h-8 w-28 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
            aria-label="Request amount in ETH"
          />
          <input
            value={requestReason}
            onChange={(event) => setRequestReason(event.target.value)}
            placeholder="inference credit top-up"
            className="h-8 min-w-56 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
            aria-label="Request reason"
          />
  <Button type="submit" size="sm" disabled={busy !== null || ensSwarm === null}>
            {busy === "request" ? "Sending…" : "Request"}
          </Button>
          {ensSwarm === null ? (
            <span className="text-xs text-muted-foreground">
              needs the org&apos;s swarm address (ENS soulvault.swarms → subdomain addr)
            </span>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">via {shortAddress(ensSwarm.address)}</span>
          )}
        </form>
      </section>

      {isOwner ? (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">
            Withdraw <span className="chip ml-2">owner</span>
          </h2>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!withdrawTo.trim() || !withdrawAmount.trim()) return;
              void run("withdraw", () =>
                withdrawFromTreasury({
                  from: address,
                  to: withdrawTo.trim() as Address,
                  amountWei: parseEthAmount(withdrawAmount),
                  treasury: active.address,
                }),
              );
            }}
          >
            <input
              value={withdrawTo}
              onChange={(event) => setWithdrawTo(event.target.value)}
              placeholder="recipient 0x…"
              className="h-8 min-w-56 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
              aria-label="Withdraw recipient address"
            />
            <input
              value={withdrawAmount}
              onChange={(event) => setWithdrawAmount(event.target.value)}
              placeholder="0.1"
              className="h-8 w-28 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
              aria-label="Withdraw amount in ETH"
            />
            <Button type="submit" size="sm" disabled={busy !== null}>
              {busy === "withdraw" ? "Sending…" : "Withdraw"}
            </Button>
          </form>
        </section>
      ) : null}

      <p className="mt-8 text-xs text-muted-foreground">
        Events: live cache {swarm.isLive ? "polling" : "idle"}. Approvals verify mutual
        consent on-chain (<span className="font-mono">swarm.treasury() == treasury</span>);
        insufficient balance reverts atomically.
      </p>

      <div className="mt-10 border-t border-border pt-6">
        <details>
          <summary className="cursor-pointer text-sm font-semibold">Deploy another treasury</summary>
          {selection.orgId ? (
            <TreasuryWizard orgEnsName={selection.orgId} />
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Select an organization first — the treasury is org-scoped and its ENSIP-11
              record needs the org ENS name.
            </p>
          )}
        </details>
      </div>
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card p-5">
      <dt className="eyebrow text-muted-foreground">{label}</dt>
      <dd className={`mt-2 text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

/**
 * All treasuries published on the org's ENS `soulvault.treasuries` record, with
 * live balances read per-chain (an org may hold treasuries on several chains —
 * ENSIP-11 slot per chain). Rows are selectable — the active treasury drives
 * every flow on the page, and the swarm's bound treasury may live on any one
 * of these chains, so switching is part of the approve/reject flow.
 */
function OrgTreasuriesSection({
  orgEnsName,
  discovery,
  activeAddress,
  watcherChainId,
  onSelect,
}: {
  orgEnsName: string | null;
  discovery: ReturnType<typeof useOrgDiscovery>;
  activeAddress: Address;
  /** Chain the shared event watcher scans (null = unknown). */
  watcherChainId: number | null;
  onSelect: (entry: OrgTreasuryEntry) => void;
}) {
  const entries = discovery.treasuries;
  const balances = discovery.treasuryBalances;

  if (!orgEnsName) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold">Org treasuries (ENS)</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        From <span className="font-mono">soulvault.treasuries</span> on{" "}
        <span className="font-mono">{orgEnsName}</span>. Flows above operate on the active
        treasury — click a row to switch. One per chain is the intended shape (ENSIP-11
        slot per chain); approve/reject must target the treasury the swarm is bound to.
      </p>
      {discovery.error ? (
        <p className="mt-3 text-sm text-destructive">{discovery.error}</p>
      ) : entries === null ? (
        <p className="mt-3 text-sm text-muted-foreground">…</p>
      ) : (
        <ul className="mt-3 divide-y divide-border border border-border">
          {entries.map((entry) => {
            const isActive = entry.address.toLowerCase() === activeAddress.toLowerCase();
            const bal = balances[entry.address.toLowerCase()];
            const watched = watcherChainId === null || watcherChainId === entry.chainId;
            return (
              <li key={`${entry.chainId}:${entry.address}`}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(entry);
                    }
                  }}
                  className={`flex w-full cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 bg-card px-4 py-3 text-left transition-colors hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                    isActive ? "border-l-2 border-l-primary" : ""
                  }`}
                  aria-pressed={isActive}
                >
                  <span className="font-mono text-xs text-muted-foreground">chain {entry.chainId}</span>
                  <CopyableAddress address={entry.address} chainId={entry.chainId} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {bal !== undefined ? `${formatEther(bal)} ETH` : "…"}
                  </span>
                  {entry.label ? <span className="text-xs text-muted-foreground">{entry.label}</span> : null}
                  {isActive ? <span className="chip text-primary">active</span> : null}
                  {!watched ? (
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      events not scanned (watcher on chain {watcherChainId ?? "?"})
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
