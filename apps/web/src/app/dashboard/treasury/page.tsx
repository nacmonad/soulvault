"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPublicClient, formatEther, http, type Address } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { useSwarmEvents } from "@/hooks/useSwarmEvents";
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
  const swarm = useSwarmEvents({ live: true, pollSeconds: 5 });
  const treasury = treasuryDeployment();
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

  const publicClient = useMemo(() => {
    const config = getBrowserSoulVaultClientConfig();
    if (!config) return null;
    return createPublicClient({
      chain: {
        id: config.chainId,
        name: `SoulVault chain ${config.chainId}`,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [config.rpcUrl] } },
      },
      transport: http(config.rpcUrl),
    });
  }, []);

  const refreshOnchain = useCallback(async () => {
    if (!publicClient || !treasury) return;
    try {
      const [bal, treasOwner] = await Promise.all([
        publicClient.getBalance({ address: treasury.address }),
        publicClient.readContract({
          address: treasury.address,
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
  }, [publicClient, treasury]);

  useEffect(() => {
    if (!address) return;
    const timer = setTimeout(() => void refreshOnchain(), 0);
    return () => clearTimeout(timer);
  }, [address, refreshOnchain]);

  if (!address) return null;

  if (!treasury) {
    return (
      <div>
        <p className="eyebrow text-primary">Treasury</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">No treasury configured</h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Add a <span className="font-mono">treasury</span> entry to{" "}
          <span className="font-mono">NEXT_PUBLIC_SOULVAULT_DEPLOYMENTS</span> after the
          creation flow lands (story08 §0). The fund-request lifecycle renders here once a
          treasury and a bound swarm are configured.
        </p>
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
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{treasury.label}</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        Org-scoped custody for native value. Payouts follow the story08 loop: a member
        requests, the owner approves or rejects, funds move in the approval transaction.
        A paid-out request is final — no revoke.
      </p>
      {txError ? <p className="mt-3 text-sm text-destructive">{txError}</p> : null}

      <dl className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-3">
        <Stat label="Balance" value={balance !== null ? `${formatEther(balance)} ETH` : "…"} mono />
        <Stat label="Owner" value={owner ? shortAddress(owner) : "…"} mono />
        <Stat label="Bound swarm" value={swarmDep ? swarmDep.label : swarm.treasury ? shortAddress(swarm.treasury) : "—"} mono />
      </dl>

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
              depositToTreasury({ from: address, amountWei: parseEthAmount(depositAmount) }),
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
