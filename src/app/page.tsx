import { Suspense } from "react";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProxmoxCard } from "@/components/proxmox/proxmox-card";
import { ServicesCard } from "@/components/services/services-card";
import { SynologyCard } from "@/components/synology/synology-card";
import { isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { hasConfiguredServices } from "@/lib/integrations/services";
import { isSynologyConfigured } from "@/lib/integrations/synology";
import { requireSession } from "@/lib/session";

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

  // Cards only appear for configured integrations; unconfigured ones are not
  // rendered at all, not even as a loading placeholder. Settings can change
  // at runtime (/settings), so this is checked on every request.
  const show = {
    synology: isSynologyConfigured(),
    services: hasConfiguredServices(),
    proxmox: isProxmoxConfigured(),
  };
  const anythingConfigured = show.synology || show.services || show.proxmox;

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <AppHeader userName={user.name} />
      {show.synology && (
        <Suspense fallback={<CardFallback title="Synology" />}>
          <SynologyCard />
        </Suspense>
      )}
      {show.services && (
        <Suspense fallback={<CardFallback title="Services" />}>
          <ServicesCard />
        </Suspense>
      )}
      {show.proxmox && (
        <Suspense fallback={<CardFallback title="Proxmox" />}>
          <ProxmoxCard />
        </Suspense>
      )}
      {anythingConfigured ? (
        <AutoRefresh intervalMs={10_000} />
      ) : (
        <p className="text-sm text-foreground/70">
          Nothing to show yet.{" "}
          <Link href="/settings" className="underline">
            Add your services in Settings
          </Link>
          .
        </p>
      )}
    </main>
  );
}
