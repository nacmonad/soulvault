import Link from "next/link";

import { LogoMark } from "@/components/brand/logo";
import { GitHubIcon } from "@/components/icons";
import { site } from "@/lib/site";

const columns = [
  {
    heading: "Product",
    links: [
      { href: "/dashboard", label: "Dashboard", external: false },
      { href: "/docs", label: "Documentation", external: false },
      { href: "/#demo", label: "Demo", external: false },
    ],
  },
  {
    heading: "Source",
    links: [
      { href: site.links.github, label: "soulvault", external: true },
      { href: site.links.presidioWeb, label: "presidio-web", external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <div className="flex items-center gap-2">
            <LogoMark className="text-primary" />
            <span className="text-[15px] font-semibold tracking-tight">
              {site.name}
            </span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {site.tagline}
          </p>
        </div>

        {columns.map((column) => (
          <div key={column.heading}>
            <h2 className="eyebrow text-muted-foreground">
              {column.heading}
            </h2>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.href}>
                  {link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-xs text-muted-foreground">
            MIT licensed · 0G Galileo + Sepolia
          </p>
          <a
            href={site.links.github}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="SoulVault on GitHub"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <GitHubIcon />
          </a>
        </div>
      </div>
    </footer>
  );
}
