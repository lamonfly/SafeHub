import type { ReactNode } from "react";

// M3 elevated card (surface container low, elevation 1, 12 px corners).
// --field-bg lets outlined text fields cut their label out of the border.
export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`flex flex-col gap-4 rounded-xl bg-surface-container-low p-4 shadow-elevation-1 [--field-bg:var(--md-surface-container-low)] sm:p-6 ${className}`}
    >
      {(title || subtitle || action) && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            {title && <h2 className="text-[22px] leading-7 text-on-surface">{title}</h2>}
            {subtitle && <p className="text-sm text-on-surface-variant">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// M3 filled card, for tiles inside an elevated card.
export function Tile({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl bg-surface-container-highest p-4 ${className}`}>{children}</div>
  );
}
