import { Suspense } from "react";
import Link from "next/link";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProxmoxCard } from "@/components/proxmox/proxmox-card";
import { ServicesCard } from "@/components/services/services-card";
import { SynologyCard } from "@/components/synology/synology-card";
import { WolCard } from "@/components/wol/wol-card";
import { requireSession } from "@/lib/session";
import { signOut } from "./(auth)/actions";

// Shown on first load while a card waits for its service (up to the request
// timeout). Refreshes keep the old card on screen instead.
function CardFallback({ title }: { title: string }) {
  return (
    <section className="rounded-lg border border-foreground/15 p-4">
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      <div className="h-16 animate-pulse rounded-md bg-foreground/5" />
    </section>
  );
}

export default async function DashboardPage() {
  const { user } = await requireSession();

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">SafeHub</h1>
        <form action={signOut} className="flex items-center gap-3 text-sm">
          <Link href="/scanner" className="text-foreground/70 hover:underline">
            Scanner
          </Link>
          <span className="text-foreground/70">{user.name}</span>
          <button
            type="submit"
            className="rounded-md border border-foreground/20 px-3 py-1.5"
          >
            Sign out
          </button>
        </form>
      </header>
      <div className="grid gap-6 md:grid-cols-2">
        <Suspense fallback={<CardFallback title="Synology" />}>
          <SynologyCard />
        </Suspense>
        <Suspense fallback={<CardFallback title="Wake on LAN" />}>
          <WolCard />
        </Suspense>
      </div>
      <Suspense fallback={<CardFallback title="Services" />}>
        <ServicesCard />
      </Suspense>
      <Suspense fallback={<CardFallback title="Proxmox" />}>
        <ProxmoxCard />
      </Suspense>
      <AutoRefresh intervalMs={10_000} />
    </main>
  );
}
