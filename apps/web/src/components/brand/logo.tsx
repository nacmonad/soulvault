import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

/**
 * Geometric mark: an outer frame (the artifact that travels) enclosing an
 * inner solid block (the fields only an authorized key resolves). Constructed
 * from two rects on a 24-unit grid — no lock iconography, no gradients.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <rect
        x="2.75"
        y="2.75"
        width="18.5"
        height="18.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect x="7" y="7" width="10" height="4" fill="currentColor" />
      <rect x="7" y="13.5" width="6" height="4" fill="currentColor" opacity="0.35" />
    </svg>
  );
}

export function Logo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("text-primary", markClassName)} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        {site.name}
      </span>
    </span>
  );
}
