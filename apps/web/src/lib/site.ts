/**
 * Single source of truth for site-wide chrome: nav, external links, metadata
 * copy. Keeps the header, footer, and page CTAs from drifting apart.
 */
export const site = {
  name: "SoulVault",
  tagline: "Coordinate securely. Collaborate privately.",
  description:
    "Encrypted continuity for agent swarms, and wallet-authorized selective disclosure for confidential documents. Redact locally, share anywhere, reveal only to authorized wallets.",
  url: "https://soulvault.dev",
  links: {
    github: "https://github.com/nacmonad/soulvault",
    presidioWeb: "https://github.com/nacmonad/presidio-web",
  },
} as const;

export type NavItem = {
  href: string;
  label: string;
  /** Rendered as a muted "soon" chip and excluded from the primary CTA set. */
  comingSoon?: boolean;
};

export const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/docs", label: "Docs", comingSoon: true },
  { href: "/#demo", label: "Demo" },
];
