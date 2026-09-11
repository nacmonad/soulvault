export type DashboardNavItem = {
  href: string;
  label: string;
  soon?: boolean;
  children?: { href: string; label: string }[];
};

export const dashboardNav: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/org", label: "Organization" },
  { href: "/dashboard/treasury", label: "Treasury" },
  { href: "/dashboard/swarm", label: "Swarm" },
  { href: "/dashboard/agents", label: "Agents" },
  {
    href: "/dashboard/documents",
    label: "Documents",
    children: [
      { href: "/dashboard/documents/registry", label: "Registry" },
      { href: "/dashboard/documents/redact", label: "1. Redact" },
      { href: "/dashboard/documents/grants", label: "2. Grants" },
      { href: "/dashboard/documents/rehydrate", label: "3. Rehydrate" },
    ],
  },
  { href: "/dashboard/events", label: "Events" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function isDashboardNavActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/dashboard/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
