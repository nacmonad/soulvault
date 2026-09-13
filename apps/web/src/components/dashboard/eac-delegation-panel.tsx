"use client";

/**
 * EAC delegation panel for a swarm's name (e.g. ops.<org>.eth): the org owner
 * grants an agent wallet scoped roles on the name's resource in the org's
 * PermissionedRegistry — the ENSv2 self-serve unlock. Per-name, per-role,
 * revocable; the agent can then write its own ENS records.
 */
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import {
  ENSV2_ROLE_NAMES,
  SELF_SERVE_ROLES,
  formatEnsV2RoleBitmap,
  grantNameEacRoles,
  grantRootEacRoles,
  readNameEacRoles,
  readRootEacRoles,
  resolveNameEacContext,
  resolveOrgRegistry,
  revokeNameEacRoles,
  revokeRootEacRoles,
  type EnsV2RoleName,
  type NameEacContext,
} from "@/lib/ensv2-eac";
import { errorMessage } from "@/lib/error-message";
import { getBrowserSoulVaultClientConfig, createSoulVaultPublicClient } from "@/lib/onchain/client";
import { shortAddress } from "@/lib/format";

const ALL_ROLES = Object.keys(ENSV2_ROLE_NAMES) as EnsV2RoleName[];

/** Root registration preset: what an agent needs to register its OWN subname. */
const SELF_REGISTER_ROLES: EnsV2RoleName[] = ["registrar"];

type GrantScope = "name" | "root";

export function EacDelegationPanel({ swarmEnsName }: { swarmEnsName: string | null }) {
  const { address } = useSoulVaultWallet();
  const [agentAddress, setAgentAddress] = useState("");
  const [targetName, setTargetName] = useState<string>(swarmEnsName ?? "");
  const [scope, setScope] = useState<GrantScope>("name");
  const [selected, setSelected] = useState<Set<EnsV2RoleName>>(new Set(SELF_SERVE_ROLES));
  const [ctx, setCtx] = useState<NameEacContext | null>(null);
  const [rootRegistry, setRootRegistry] = useState<Address | null>(null);
  const [held, setHeld] = useState<{ account: Address; roles: EnsV2RoleName[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const client = useMemoClient();

  // Re-resolve when the swarm (and thus the default name) changes.
  useEffect(() => {
    setTargetName(swarmEnsName ?? "");
    setCtx(null);
    setRootRegistry(null);
    setHeld(null);
  }, [swarmEnsName]);

  // Scope switch invalidates the resolved context (name resource vs registry root).
  useEffect(() => {
    setCtx(null);
    setRootRegistry(null);
    setHeld(null);
    setError(null);
    setNotice(null);
  }, [scope]);

  const lookup = useCallback(
    async (account: Address) => {
      const name = targetName.trim();
      if (!name || !address || !client) return;
      setBusy("lookup");
      setError(null);
      setNotice(null);
      try {
        if (scope === "root") {
          const registry = await resolveOrgRegistry({ fullName: name, viewer: address, client });
          if (!registry) {
            setRootRegistry(null);
            setHeld(null);
            setError(`${name} is not in an ENSv2 org registry — register the org name first.`);
            return;
          }
          setRootRegistry(registry);
          const roles = await readRootEacRoles({ registry, client, account });
          setHeld({ account, roles: roles.roles });
          return;
        }
        const resolved = await resolveNameEacContext({ fullName: name, viewer: address, client });
        if (!resolved) {
          setCtx(null);
          setHeld(null);
          setError(`${name} is not in an ENSv2 registry — register the name first (swarm/agent register-ens).`);
          return;
        }
        setCtx(resolved);
        const roles = await readNameEacRoles({ ctx: resolved, client, account });
        setHeld({ account, roles: roles.roles });
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(null);
      }
    },
    [targetName, address, client, scope],
  );

  async function runGrant() {
    if (!address || !agentAddress.trim()) return;
    if (scope === "root" && !rootRegistry) {
      setError("Resolve the registry first (Check roles).");
      return;
    }
    if (scope !== "root" && !ctx) return;
    const bitmap = [...selected].reduce((acc, role) => acc | ENSV2_ROLE_NAMES[role], 0n);
    if (bitmap === 0n) {
      setError("Select at least one role to grant.");
      return;
    }
    setBusy("grant");
    setError(null);
    setNotice(null);
    try {
      if (scope === "root") {
        if (!rootRegistry) {
          setError("Resolve the registry first (Check roles).");
          return;
        }
        await grantRootEacRoles({
          from: address,
          registry: rootRegistry,
          account: agentAddress.trim() as Address,
          roleBitmap: bitmap,
        });
        setNotice(`Granted ${formatEnsV2RoleBitmap(bitmap).join(", ")} on REGISTRY ROOT (${shortAddress(rootRegistry)}) → ${shortAddress(agentAddress.trim() as Address)}.`);
        await lookup(agentAddress.trim() as Address);
        return;
      }
      const nameCtx = ctx;
      if (!nameCtx) return;
      await grantNameEacRoles({
        from: address,
        fullName: nameCtx.fullName,
        ctx: nameCtx,
        account: agentAddress.trim() as Address,
        roleBitmap: bitmap,
      });
      setNotice(`Granted ${formatEnsV2RoleBitmap(bitmap).join(", ")} on ${nameCtx.fullName} → ${shortAddress(agentAddress.trim() as Address)}.`);
      await lookup(agentAddress.trim() as Address);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function runRevoke() {
    if (!address || !agentAddress.trim()) return;
    if (scope === "root" && !rootRegistry) {
      setError("Resolve the registry first (Check roles).");
      return;
    }
    if (scope !== "root" && !ctx) return;
    const bitmap = [...selected].reduce((acc, role) => acc | ENSV2_ROLE_NAMES[role], 0n);
    if (bitmap === 0n) {
      setError("Select at least one role to revoke.");
      return;
    }
    setBusy("revoke");
    setError(null);
    setNotice(null);
    try {
      if (scope === "root") {
        if (!rootRegistry) {
          setError("Resolve the registry first (Check roles).");
          return;
        }
        await revokeRootEacRoles({
          from: address,
          registry: rootRegistry,
          account: agentAddress.trim() as Address,
          roleBitmap: bitmap,
        });
        setNotice(`Revoked ${formatEnsV2RoleBitmap(bitmap).join(", ")} on REGISTRY ROOT from ${shortAddress(agentAddress.trim() as Address)}.`);
        await lookup(agentAddress.trim() as Address);
        return;
      }
      const nameCtx = ctx;
      if (!nameCtx) return;
      await revokeNameEacRoles({
        from: address,
        fullName: nameCtx.fullName,
        ctx: nameCtx,
        account: agentAddress.trim() as Address,
        roleBitmap: bitmap,
      });
      setNotice(`Revoked ${formatEnsV2RoleBitmap(bitmap).join(", ")} on ${nameCtx.fullName} from ${shortAddress(agentAddress.trim() as Address)}.`);
      await lookup(agentAddress.trim() as Address);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (!swarmEnsName) return null;

  return (
    <div className="mt-8 border-t border-border pt-6">
      <h2 className="text-sm font-semibold">Agent delegation (ENSv2 EAC)</h2>
      <p className="mt-1 max-w-xl text-xs text-muted-foreground">
        Grant EAC roles to an agent wallet. Name scope: record self-serve on one name (set-resolver,
        renew). Registry-root scope: registration rights — registering a fresh label checks
        ROLE_REGISTRAR on resource 0, which name-scoped grants cannot express. CLI twins:{" "}
        <span className="font-mono">soulvault ens grant</span> /{" "}
        <span className="font-mono">soulvault ens grant-root</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">scope:</span>
        <button
          type="button"
          onClick={() => setScope("name")}
          className={`chip cursor-pointer text-xs ${scope === "name" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
        >
          name
        </button>
        <button
          type="button"
          onClick={() => setScope("root")}
          className={`chip cursor-pointer text-xs ${scope === "root" ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
        >
          registry root
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={targetName ?? ""}
          onChange={(event) => setTargetName(event.target.value)}
          placeholder="ops.<org>.eth or <agent>.ops.<org>.eth"
          className="h-8 min-w-64 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
        />
        <input
          value={agentAddress}
          onChange={(event) => setAgentAddress(event.target.value)}
          placeholder="0x… agent wallet"
          className="h-8 min-w-56 border border-border bg-card px-2 font-mono text-sm outline-none focus:border-ring"
        />
        <Button
          size="xs"
          variant="outline"
          disabled={busy !== null || !agentAddress.trim()}
          onClick={() => void lookup(agentAddress.trim() as Address)}
        >
          {busy === "lookup" ? "…" : "Check roles"}
        </Button>
        {held ? (
          <span className="text-xs text-muted-foreground">
            holds: {held.roles.length > 0 ? held.roles.join(", ") : "none"}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {ALL_ROLES.map((role) => {
          const isOn = selected.has(role);
          return (
            <button
              key={role}
              type="button"
              onClick={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(role)) next.delete(role);
                  else next.add(role);
                  return next;
                })
              }
              className={`chip cursor-pointer text-xs ${isOn ? "bg-primary/10 text-primary" : "text-muted-foreground"}`}
            >
              {role}
            </button>
          );
        })}
        <button
          type="button"
          className="cursor-pointer text-xs text-muted-foreground underline decoration-dotted"
          onClick={() => setSelected(new Set(SELF_SERVE_ROLES))}
        >
          preset: self-serve
        </button>
        <button
          type="button"
          className="cursor-pointer text-xs text-muted-foreground underline decoration-dotted"
          onClick={() => {
            setScope("root");
            setSelected(new Set(SELF_REGISTER_ROLES));
          }}
        >
          preset: self-register (root)
        </button>
      </div>
      {scope === "root" ? (
        <p className="mt-2 max-w-xl text-xs text-amber-600 dark:text-amber-400">
          Root grants are registry-wide: registrar lets the holder register ANY label on this
          registry. Revoke when the agent no longer needs it.
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button
          size="xs"
          disabled={busy !== null || !agentAddress.trim() || (scope === "root" ? !rootRegistry : !ctx)}
          onClick={() => void runGrant()}
        >
          {busy === "grant" ? "Signing…" : "Grant"}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={busy !== null || !agentAddress.trim() || (scope === "root" ? !rootRegistry : !ctx)}
          onClick={() => void runRevoke()}
        >
          {busy === "revoke" ? "Signing…" : "Revoke"}
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-primary">{notice}</p> : null}
    </div>
  );
}

function useMemoClient() {
  const [client, setClient] = useState<ReturnType<typeof createSoulVaultPublicClient> | null>(null);
  useEffect(() => {
    const config = getBrowserSoulVaultClientConfig();
    if (config) setClient(createSoulVaultPublicClient(config));
  }, []);
  return client;
}
