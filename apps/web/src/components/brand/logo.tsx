import { cn } from "@/lib/utils";
import { site } from "@/lib/site";

/**
 * Constellation Shield: a protected, living swarm. This is the reductive SVG
 * counterpart to the original luminous shield used in the SoulVault slides.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      aria-hidden="true"
      className={cn("size-6", className)}
    >
      <path
        d="M128 20C154 40 185 48 218 54V116C218 174 182 216 128 238C74 216 38 174 38 116V54C71 48 102 40 128 20Z"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinejoin="round"
      />
      <path
        d="M78 104L111 78L145 112L180 76M111 78L124 158M145 112L124 158L170 164"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="78" cy="104" r="10" fill="currentColor" />
      <circle cx="111" cy="78" r="10" fill="currentColor" />
      <circle cx="145" cy="112" r="10" fill="currentColor" />
      <circle cx="180" cy="76" r="10" fill="currentColor" />
      <circle cx="124" cy="158" r="10" fill="currentColor" />
      <circle cx="170" cy="164" r="10" fill="currentColor" />
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
