import type { Metadata } from "next";

import { GitHubIcon } from "@/components/icons";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Protocol specs, CLI reference, and walkthroughs. Currently published in the repository.",
};

const planned = [
  {
    title: "Protocol",
    body: "Wire formats, epoch-key wrapping, the hydration manifest, and the on-chain policy surface.",
    source: "docs/protocol-v0.1.md",
  },
  {
    title: "CLI reference",
    body: "Every command across organization, swarm, treasury, epoch, backup, and messaging.",
    source: "skills/soulvault/references/commands.md",
  },
  {
    title: "Stories",
    body: "Copy-pasteable walkthroughs, from bootstrapping an org to the full fund-request flow.",
    source: "stories/",
  },
  {
    title: "Cryptography",
    body: "What is encrypted with what, and which guarantees each primitive actually provides.",
    source: "skills/soulvault/references/crypto.md",
  },
];

export default function DocsPage() {
  return (
    <PageShell
      eyebrow="Documentation"
      title="Not published here yet"
      description="The specs, CLI reference, and walkthroughs all exist — they currently live in the repository as Markdown. This section will render them once the protocol surface settles."
    >
      <Button
        render={
          <a href={site.links.github} target="_blank" rel="noopener noreferrer" />
        }
      >
        <GitHubIcon />
        Read the docs on GitHub
      </Button>

      <div className="mt-12 grid gap-px border border-border bg-border sm:grid-cols-2">
        {planned.map((item) => (
          <div key={item.title} className="bg-card p-6">
            <h2 className="font-semibold tracking-tight">{item.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.body}
            </p>
            <p className="mt-4 font-mono text-xs break-all text-muted-foreground">
              {item.source}
            </p>
          </div>
        ))}
      </div>
    </PageShell>
  );
}
