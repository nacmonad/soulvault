"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useDashboardSelection } from "@/components/dashboard/selection-provider";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { TreasuryWizard } from "@/components/create/treasury-wizard";
import { useOrgDiscovery } from "@/hooks/useOrgDiscovery";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
import { SEPOLIA_CHAIN_ID, publicClientForChainId } from "@/lib/chains";
import { getBrowserSoulVaultClientConfig } from "@/lib/onchain/client";
import {
  approveFundRequest,
  cancelFundRequest,
  depositToTreasury,
  parseEthAmount,
  rejectFundRequest,
  requestFunds,
  swarmDeployment,
  treasuryDeployment,
  withdrawFromTreasury,
} from "@/lib/treasury-contract";
import { shortAddress } from "@/lib/format";

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

export default function TreasuryPage() {
  const { address } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const swarm = useSwarmEvents({ live: true, pollSeconds: 5 });
  const discovery = useOrgDiscovery(selection.orgId);
  const envTreasury = treasuryDeployment();
  const swarmDep = swarmDeployment();

  const [balance, setBalance] = useState<bigint | null>(null);
  const [owner, setOwner] = useState<Address | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [depositAmount, setDepositAmount] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");

  /**
   * Active treasury: env deployment wins (explicit operator intent), otherwise
   * the first treasury published on the org's ENS `soulvault.treasuries` record.
   * Flows target this address explicitly, so a treasury known only via ENS is
   * fully operable without env config.
   */
  const active = useMemo(() => {
    if (envTreasury) {
      const config = getBrowserSoulVaultClientConfig();
      return {
        address: envTreasury.address,
        chainId: config?.chainId ?? SEPOLIA_CHAIN_ID,
        label: envTreasury.label,
        source: "env" as const,
      };
    }
    const first = discovery.treasuries?.[0];
    if (first) {
      return {
        address: getAddress(first.address),
        chainId: first.chainId,
        label: first.label ?? shortAddress(first.address),
        source: "ens" as const,
      };
    }
    return null;
  }, [envTreasury, discovery.treasuries]);

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
  const isOwner = owner !== null && owner.toLowerCase() === address.toLowerCase();

  async function run(key: string, action: () => Promise<string>) {
    setTxError(null);
    setBusy(key);
    try {
      await action();
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
        {active.source === "ens"
          ? `Resolved from the org's ENS soulvault.treasuries record (${selection.orgId}).`
          : "Configured via NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS."}{" "}
        Org-scoped custody for native value. Payouts follow the story08 loop: a member
        requests, the owner approves or rejects, funds move in the approval transaction.
        A paid-out request is final — no revoke.
      </p>
      {txError ? <p className="mt-3 text-sm text-destructive">{txError}</p> : null}

      <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-3">
        <Stat label="Balance" value={balance !== null ? `${formatEther(balance)} ETH` : "…"} mono />
        <Stat label="Owner" value={owner ? shortAddress(owner) : "…"} mono />
        <Stat label="Chain" value={String(active.chainId)} mono />
      </dl>
      <p className="mt-2 font-mono text-xs text-muted-foreground">{active.address}</p>

      <OrgTreasuriesSection
        orgEnsName={selection.orgId}
        discovery={discovery}
        activeAddress={active.address}
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
          <p className="mt-3 text-sm text-muted-foreground">No fund requests yet.</p>
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
                            disabled={busy !== null}
                            onClick={() =>
                              swarmDep &&
                              void run("approve", () =>
                                approveFundRequest({
                                  from: address,
                                  swarm: swarmDep.address,
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
                            disabled={busy !== null}
                            onClick={() =>
                              swarmDep &&
                              void run("reject", () =>
                                rejectFundRequest({
                                  from: address,
                                  swarm: swarmDep.address,
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
                                () => cancelFundRequest({ from: address, requestId: request.requestId }),
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
            void run("request", () =>
              requestFunds({
                from: address,
                amountWei: parseEthAmount(requestAmount),
                reason: requestReason.trim() || "fund request",
              }),
            );
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
          <Button type="submit" size="sm" disabled={busy !== null}>
            {busy === "request" ? "Sending…" : "Request"}
          </Button>
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
 * ENSIP-11 slot per chain). The active treasury (driving the flows above) is
 * marked; the others are read-only entries.
 */
function OrgTreasuriesSection({
  orgEnsName,
  discovery,
  activeAddress,
}: {
  orgEnsName: string | null;
  discovery: ReturnType<typeof useOrgDiscovery>;
  activeAddress: Address;
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
        treasury; one per chain is the intended shape (ENSIP-11 slot per chain).
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
            return (
              <li key={`${entry.chainId}:${entry.address}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-card px-4 py-3">
                <span className="font-mono text-xs text-muted-foreground">chain {entry.chainId}</span>
                <span className="font-mono text-sm">{shortAddress(entry.address)}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {bal !== undefined ? `${formatEther(bal)} ETH` : "…"}
                </span>
                {entry.label ? <span className="text-xs text-muted-foreground">{entry.label}</span> : null}
                {isActive ? <span className="chip text-primary">active</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
