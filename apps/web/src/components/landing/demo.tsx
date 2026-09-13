import { Section } from "@/components/landing/section";

/**
 * Walkthrough recording embed (youtu.be/yX8Il3XSTwA).
 * Click-to-load facade keeps the landing page light; the framing chrome stays.
 */
export function Demo() {
  return (
    <Section
      id="demo"
      eyebrow="Demo"
      title="Watch a document survive the wrong inbox"
      description="A walkthrough of the full path: redact a referral letter, email it, hydrate it as the authorized recipient, then watch an unauthorized wallet get nothing."
    >
      <div className="border border-border bg-card p-2">
        <div className="aspect-video border border-border-strong bg-background">
          <iframe
            className="h-full w-full"
            src="https://www.youtube-nocookie.com/embed/yX8Il3XSTwA"
            title="SoulVault — Redact Rehydrate Demo (ETHOnline 2026)"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </Section>
  );
}
