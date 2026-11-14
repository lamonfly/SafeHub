import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { unreadCount } from "@/lib/alerts/store";
import { Icon } from "./ui/icons";
import { UpdateBadge } from "./update-badge";

// Icon button on phones (48 px target), icon + text from sm up.
const actionClass =
  "relative inline-flex min-h-12 min-w-12 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium text-on-surface-variant hover:bg-on-surface/8 focus-visible:outline-3 focus-visible:outline-primary sm:min-h-10";

// M3 small top app bar. Sticky, and padded for phone notches (safe areas).
export function AppHeader({ userName }: { userName: string }) {
  const unread = unreadCount();

  return (
    <header className="sticky top-0 z-10 bg-surface/95 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-surface/85">
      <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-2 pr-[max(0.25rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] sm:pr-6 sm:pl-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="truncate text-[22px] leading-7 text-on-surface">
            SafeHub
          </Link>
          {/* Never hold the page for GitHub: render the badge when it is ready. */}
          <Suspense fallback={null}>
            <UpdateBadge />
          </Suspense>
        </div>
        <form action={signOut} className="flex shrink-0 items-center">
          <span className="hidden px-2 text-sm text-on-surface-variant md:inline">{userName}</span>
          <Link href="/alerts" className={actionClass} aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}>
            <Icon name="bell" />
            <span className="hidden sm:inline">Alerts</span>
            {unread > 0 && (
              // M3 badge: on the icon on phones, after the label on wider screens
              <span className="absolute top-1.5 left-7 flex h-4 min-w-4 sm:static items-center justify-center rounded-full bg-error px-1 text-[11px] leading-none font-medium text-on-error">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          <Link href="/settings" className={actionClass} aria-label="Settings">
            <Icon name="settings" />
            <span className="hidden sm:inline">Settings</span>
          </Link>
          <button type="submit" className={actionClass} aria-label="Sign out">
            <Icon name="logout" />
            <span className="hidden sm:inline">Sign out</span>
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
