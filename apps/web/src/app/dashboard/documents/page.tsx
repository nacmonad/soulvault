"use client";

import Link from "next/link";

export default function DocumentsIndexPage() {
  return (
    <div>
      <p className="eyebrow text-primary">Documents</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Redact → grant → rehydrate</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">
        This is the product. PII is detected on this machine. The chain only sees a
        document hash and slot ids. A wallet grant unlocks specific fields for one
        recipient. Everyone else gets ciphertext.
      </p>

      <ol className="mt-8 grid gap-px border border-border bg-border sm:grid-cols-3">
        <Step
          n="1"
          href="/dashboard/documents/redact"
          title="Redact"
          body="Paste a note. Presidio (local) finds PII. You confirm slots, encrypt, publish the hash."
        />
        <Step
          n="2"
          href="/dashboard/documents/grants"
          title="Grant"
          body="Someone requests rehydration. You sign which slots they may see. Ledger or injected wallet."
        />
        <Step
          n="3"
          href="/dashboard/documents/rehydrate"
          title="Rehydrate"
          body="Paste the public bundle. Only granted slots decrypt. Optional World Selfie on READ."
        />
      </ol>

      <p className="mt-6 text-sm text-muted-foreground">
        Registry contract lives on{" "}
        <Link href="/dashboard/documents/registry" className="underline">
          Document Registry
        </Link>
        . Org ENS is only how the registry is discovered.
      </p>
    </div>
  );
}

function Step({
  n,
  href,
  title,
  body,
}: {
  n: string;
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="block bg-card p-5 hover:bg-muted/40">
      <p className="text-xs text-muted-foreground">Step {n}</p>
      <p className="mt-2 font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </Link>
  );
}
