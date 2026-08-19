import { Section } from "@/components/landing/section";

const steps = [
  {
    step: "01",
    title: "Redact locally",
    body: "presidio-web detects PII in the browser and swaps each span for an opaque slot id. Plaintext never leaves the device during preparation.",
  },
  {
    step: "02",
    title: "Encrypt and commit",
    body: "The removed fields are sealed under a fresh data key and stored on 0G. Only a commitment, a policy root, and a nonce go on-chain.",
  },
  {
    step: "03",
    title: "Send it anywhere",
    body: "The redacted artifact travels through Gmail, Slack, or a USB stick. It is safe to forward, because it carries nothing that was removed.",
  },
  {
    step: "04",
    title: "Hydrate by wallet",
    body: "The recipient connects a wallet and signs. SoulVault checks the grant, wraps the key to their session, and the browser reveals only permitted fields.",
  },
];

export function HowItWorks() {
  return (
    <Section
      eyebrow="How it works"
      title="The document that leaks is the one that reveals nothing"
      description="Four steps, no server holding your plaintext at any point in the chain."
    >
      <ol className="grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <li key={step.step} className="bg-card p-6">
            <span className="font-mono text-xs tracking-widest text-primary">
              {step.step}
            </span>
            <h3 className="mt-3 font-semibold tracking-tight">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {step.body}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-8 border-l-2 border-primary bg-card py-3 pl-4 text-sm text-muted-foreground">
        Revocation is forward-looking. It stops every future hydration, but it
        cannot make a recipient forget plaintext they already read — which is
        why fields an agent only needs to compute over are granted{" "}
        <span className="font-mono text-foreground">USE</span>, never{" "}
        <span className="font-mono text-foreground">READ</span>.
      </p>
    </Section>
  );
}
