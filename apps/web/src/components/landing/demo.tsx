import { Play } from "lucide-react";

import { Section } from "@/components/landing/section";

/**
 * Placeholder for the walkthrough recording. Swap the inner block for a
 * <video> or embed once the demo is cut; the framing chrome stays.
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
        <div className="flex aspect-video flex-col items-center justify-center gap-4 border border-dashed border-border-strong bg-background">
          <span className="flex size-12 items-center justify-center border border-border-strong text-muted-foreground">
            <Play className="size-5" />
          </span>
          <div className="text-center">
            <p className="text-sm font-medium">Walkthrough recording</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              in production
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}
