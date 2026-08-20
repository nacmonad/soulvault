export function PageShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-16">
      <p className="eyebrow text-primary">
        {eyebrow}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
        {title}
      </h1>
      <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
        {description}
      </p>
      {children ? <div className="mt-12">{children}</div> : null}
    </div>
  );
}
