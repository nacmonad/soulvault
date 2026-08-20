import Link from "next/link";

import { LogoMark } from "@/components/brand/logo";
import { GitHubIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { site } from "@/lib/site";

export function Hero() {
  return (
    <section className="relative border-b border-border">
      <div
        aria-hidden="true"
        className="grid-field pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] opacity-60"
      />
      <div className="relative mx-auto w-full max-w-6xl px-6 py-24 sm:py-32">
        <div className="flex items-center gap-16">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-2 border border-border bg-card px-2.5 py-1 eyebrow text-muted-foreground">
              <span className="size-1.5 bg-primary" />
              Pre-launch · 0G Galileo + Sepolia
            </p>

            <h1 className="mt-6 max-w-3xl text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-5xl">
              Coordinate securely.
              <br />
              <span className="text-primary">Collaborate privately.</span>
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              SoulVault keeps agent swarms alive across ephemeral sessions, and
              lets humans and agents share sensitive documents through ordinary
              channels. Fields are redacted locally and reconstructed only by
              wallets that are authorized to see them.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button render={<Link href="/dashboard" />} size="lg">
                Open dashboard
              </Button>
              <Button
                render={
                  <a
                    href={site.links.github}
                    target="_blank"
                    rel="noopener noreferrer"
                  />
                }
                variant="outline"
                size="lg"
              >
                <GitHubIcon />
                View source
              </Button>
            </div>
          </div>

          {/* The mark carries the pitch on its own: a swarm held inside a
              boundary. Decorative here — the wordmark in the header names it. */}
          <LogoMark className="hidden size-56 shrink-0 text-primary lg:block" />
        </div>

        <dl className="mt-16 grid max-w-3xl grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
          {[
            { value: "AES-256", label: "GCM payloads" },
            { value: "secp256k1", label: "ECDH key wrap" },
            { value: "Isomorphic", label: "browser + node" },
            { value: "Zero PII", label: "on-chain" },
          ].map((stat) => (
            <div key={stat.label} className="bg-card px-4 py-4">
              <dt className="font-mono text-[15px] text-foreground">
                {stat.value}
              </dt>
              <dd className="mt-1 text-xs text-muted-foreground">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
