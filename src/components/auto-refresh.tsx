"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Re-renders the current page's Server Components on an interval.
// Pauses while the tab is hidden to avoid polling services for nobody.
export function AutoRefresh({ intervalMs }: { intervalMs: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
