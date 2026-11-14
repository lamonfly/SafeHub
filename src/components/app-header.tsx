import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { buttonClass } from "./ui/button";
import { UpdateBadge } from "./update-badge";

// M3 small top app bar. Sticky, and padded for phone notches (safe areas).
export function AppHeader({ userName }: { userName: string }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-2 pr-[max(0.5rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:pr-6 sm:pl-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="truncate text-[22px] leading-7 text-on-surface">
            SafeHub
          </Link>
          {/* Never hold the page for GitHub: render the badge when it is ready. */}
          <Suspense fallback={null}>
            <UpdateBadge />
          </Suspense>
        </div>
        <form action={signOut} className="flex shrink-0 items-center gap-1">
          <span className="hidden px-2 text-sm text-on-surface-variant sm:inline">{userName}</span>
          <Link href="/settings" className={buttonClass("text")}>
            Settings
          </Link>
          <button type="submit" className={buttonClass("text")}>
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

// Page body below the top app bar: centered, with side and bottom padding
// that respects safe areas.
export function PageBody({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 pt-2 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:gap-6 sm:px-6">
      {children}
    </main>
  );
}
