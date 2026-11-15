import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";

// Name that opens the history charts; the chevron hints it is tappable. The
// after: box extends the tap area to 48 px without changing the layout.
export function HistoryLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`relative inline-flex min-w-0 items-center gap-0.5 after:absolute after:inset-x-0 after:top-1/2 after:h-12 after:-translate-y-1/2 after:content-[''] hover:underline ${className}`}
    >
      <span className="truncate">{children}</span>
      <Icon name="chevronRight" className="size-5 text-on-surface-variant" />
    </Link>
  );
}
