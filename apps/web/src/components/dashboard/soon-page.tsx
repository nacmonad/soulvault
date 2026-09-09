"use client";

export function SoonPage({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="eyebrow text-primary">{eyebrow}</p>
      <div className="mt-3 flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <span className="chip border border-border px-1.5 py-0.5 text-muted-foreground">
          soon
        </span>
      </div>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}
