"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ConnectPanel } from "@/components/dashboard/connect-panel";
import { DashboardSelectionProvider, useDashboardSelection } from "@/components/dashboard/selection-provider";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useSoulVaultWallet } from "@/components/providers/soulvault-ledger-provider";
import { dashboardNav, isDashboardNavActive } from "@/lib/dashboard-nav";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { address } = useSoulVaultWallet();

  return (
    <DashboardSelectionProvider>
      <DashboardChrome>{address ? children : <ConnectPanel />}</DashboardChrome>
    </DashboardSelectionProvider>
  );
}

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const { address, connector, disconnect, status } = useSoulVaultWallet();
  const { selection } = useDashboardSelection();
  const documentsOpen = pathname.startsWith("/dashboard/documents");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-px border-x border-border md:flex-row">
      <aside className="w-full shrink-0 border-b border-border bg-card md:w-56 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <LogoMark className="size-5 text-primary" />
          <span className="text-sm font-semibold tracking-tight">Dashboard</span>
        </div>
        <nav className="flex flex-col p-2" aria-label="Dashboard">
          {dashboardNav.map((item) => {
            const active = isDashboardNavActive(pathname, item.href);
            return (
              <div key={item.href}>
                <Link
                  href={item.children ? item.children[0].href : item.href}
                  className={cn(
                    "flex items-center justify-between px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{item.label}</span>
                </Link>
                {item.children && (documentsOpen || active) ? (
                  <div className="mb-1 ml-3 border-l border-border">
                    {item.children.map((child) => (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "block px-3 py-1.5 text-sm transition-colors",
                          isDashboardNavActive(pathname, child.href)
                            ? "text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {child.label}
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {address ? (
            <div className="space-y-2">
              <p className="font-mono text-foreground">{shortAddress(address)}</p>
              <p className="chip">{connector ?? "wallet"}</p>
              <p>Org {selection.orgId ?? "—"}</p>
              <p>Swarm {selection.swarmId ?? "—"}</p>
              <Button variant="ghost" size="xs" onClick={() => void disconnect()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <p>{status === "connecting" ? "Connecting…" : "Not connected"}</p>
          )}
        </div>
      </aside>
      <section className="min-w-0 flex-1 bg-background p-6 md:p-8">{children}</section>
    </div>
  );
}
