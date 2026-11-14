import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/icons";

// Name that opens the history charts; the chevron hints it is tappable.
export function HistoryLink({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={`inline-flex min-w-0 items-center gap-0.5 hover:underline ${className}`}>
      <span className="truncate">{children}</span>
      <Icon name="chevronRight" className="size-5 text-on-surface-variant" />
    </Link>
  );
}
