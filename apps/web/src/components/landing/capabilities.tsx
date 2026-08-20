import {
  Archive,
  EyeOff,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Section } from "@/components/landing/section";

const capabilities = [
  {
    label: "Foundation",
    title: "Continuity for agent swarms",
    body: "Agent sessions end. Their skills, memory, and shared state shouldn't. SoulVault backs up swarm state under a rotating epoch key, restores it on any machine, and governs membership through contract events.",
    points: [
      { icon: Archive, text: "Encrypted backup, restore, and transfer" },
      { icon: RefreshCw, text: "Epoch rotation on membership change" },
      { icon: Users, text: "Join requests and owner approval on-chain" },
    ],
  },
  {
    label: "Extension",
    title: "Selective disclosure for documents",
    body: "Redaction runs locally. What travels through email or Slack carries no sensitive fields at all — so forwarding it to the wrong person discloses nothing. Authorized wallets reconstruct only their permitted slots.",
    points: [
      { icon: EyeOff, text: "Redact locally, send the artifact anywhere" },
      { icon: KeyRound, text: "Per-field grants scoped to a wallet" },
      { icon: ShieldCheck, text: "Revocation blocks every future hydration" },
    ],
  },
];

export function Capabilities() {
  return (
    <Section
      eyebrow="What it does"
      title="One cryptographic core, two problems it solves"
      description="The same secp256k1 ECDH and AES-256-GCM primitives that keep a swarm's state recoverable also decide which fields of a document a given wallet can reconstruct."
    >
      <div className="grid gap-px border border-border bg-border lg:grid-cols-2">
        {capabilities.map((capability) => (
          <div key={capability.title} className="bg-card p-8">
            <p className="eyebrow text-muted-foreground">
              {capability.label}
            </p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">
              {capability.title}
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {capability.body}
            </p>
            <ul className="mt-6 space-y-3 border-t border-border pt-6">
              {capability.points.map((point) => (
                <li key={point.text} className="flex items-start gap-3">
                  <point.icon className="mt-0.5 size-4 shrink-0 text-primary" />
                  <span className="text-sm text-foreground">{point.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Section>
  );
}
