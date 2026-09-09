export type DashboardNavItem = {
  href: string;
  label: string;
  soon?: boolean;
  children?: { href: string; label: string }[];
};

export const dashboardNav: DashboardNavItem[] = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/org", label: "Organization" },
  { href: "/dashboard/swarm", label: "Swarm" },
  { href: "/dashboard/treasury", label: "Treasury" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/events", label: "Events" },
  {
    href: "/dashboard/documents",
    label: "Documents",
    children: [
      { href: "/dashboard/documents/redact", label: "Redact" },
      { href: "/dashboard/documents/grants", label: "Grants" },
      { href: "/dashboard/documents/rehydrate", label: "Rehydrate" },
    ],
  },
  { href: "/dashboard/settings", label: "Settings" },
];

export function isDashboardNavActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard" || pathname === "/dashboard/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
