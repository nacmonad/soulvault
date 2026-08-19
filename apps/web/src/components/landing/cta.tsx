import Link from "next/link";

import { GitHubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

export function Cta() {
  return (
    <section className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-16 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            Run it against a testnet in a few commands
          </h2>
          <p className="mt-3 leading-relaxed text-muted-foreground">
            The CLI, contracts, and protocol core are open source. Clone the
            repo, point it at 0G Galileo and Sepolia, and walk through the
            stories.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row">
          <Button
            render={
              <a
                href={site.links.github}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
            size="lg"
          >
            <GitHubIcon />
            Read the source
          </Button>
          <Button render={<Link href="/docs" />} variant="outline" size="lg">
            Documentation
          </Button>
        </div>
      </div>
    </section>
  );
}
