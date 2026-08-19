import { cn } from "@/lib/utils";

export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("border-b border-border scroll-mt-14", className)}
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-20">
        <p className="font-mono text-[11px] tracking-widest text-primary uppercase">
          {eyebrow}
        </p>
        <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {title}
        </h2>
        {description ? (
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}
