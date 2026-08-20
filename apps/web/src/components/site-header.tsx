import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { navItems, site } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label={`${site.name} home`}>
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
              {item.comingSoon ? (
                <span className="rounded-xs bg-muted px-1.5 py-0.5 chip text-muted-foreground">
                  soon
                </span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Button
            render={
              <a
                href={site.links.github}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
          >
            <GitHubIcon />
            GitHub
          </Button>
          <Button render={<Link href="/dashboard" />} size="sm">
            Dashboard
          </Button>
        </div>
      </div>
    </header>
  );
}
