import { Suspense } from "react";
import Link from "next/link";
import { OpenAlertsCard } from "@/components/alerts/open-alerts-card";
import { AppHeader, PageBody } from "@/components/app-header";
import { AutoRefresh } from "@/components/auto-refresh";
import { ProxmoxCard } from "@/components/proxmox/proxmox-card";
import { ServicesCard } from "@/components/services/services-card";
import { SynologyCard } from "@/components/synology/synology-card";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { hasConfiguredServices } from "@/lib/integrations/services";
import { isSynologyConfigured } from "@/lib/integrations/synology";
import { requireSession } from "@/lib/session";

// Shown on first load while a card waits for its service (up to the request
// timeout). Refreshes keep the old card on screen instead.
function CardFallback({ title }: { title: string }) {
  return (
    <Card title={title}>
      <div className="h-16 animate-pulse rounded-lg bg-surface-container-highest" />
    </Card>
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
    <>
      <AppHeader userName={user.name} />
      <PageBody>
        <OpenAlertsCard />
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
          <Card title="Nothing to show yet" subtitle="Add your servers and services to see them here.">
            <div>
              <Link href="/settings" className={buttonClass("filled")}>
                Open Settings
              </Link>
            </div>
          </Card>
        )}
      </PageBody>
    </>
  );
}
