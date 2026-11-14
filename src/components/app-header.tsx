import { Suspense } from "react";
import Link from "next/link";
import { signOut } from "@/app/(auth)/actions";
import { UpdateBadge } from "./update-badge";

export function AppHeader({ userName }: { userName: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-2xl font-semibold">
          SafeHub
        </Link>
        {/* Never hold the page for GitHub: render the badge when it is ready. */}
        <Suspense fallback={null}>
          <UpdateBadge />
        </Suspense>
      </div>
      <form action={signOut} className="flex items-center gap-3 text-sm">
        <Link href="/settings" className="text-foreground/70 hover:underline">
          Settings
        </Link>
        <span className="text-foreground/70">{userName}</span>
        <button type="submit" className="rounded-md border border-foreground/20 px-3 py-1.5">
          Sign out
        </button>
      </form>
    </header>
  );
}
