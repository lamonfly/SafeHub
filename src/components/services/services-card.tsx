import { Suspense } from "react";
import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { Card, Tile } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status-dot";
import type { IntegrationResult } from "@/lib/integrations/result";
import { getServicePlacement, getServiceTile } from "@/lib/dashboard";
import type { SeerrRequest } from "@/lib/integrations/seerr";
import type { ServiceInfo, ServiceStatus } from "@/lib/integrations/services";
import { SeerrRequests } from "./seerr-requests";
import { ServiceActions } from "./service-actions";

// One service with its stats, warnings and buttons. Also used under the
// Proxmox guest the service runs on.
export function ServiceTile({
  service,
  pending,
}: {
  service: ServiceStatus;
  pending?: IntegrationResult<SeerrRequest[]>;
}) {
  const { result } = service;
  const hasIssues = result.status === "ok" && result.data.issues.length > 0;
  const [tone, label] =
    result.status === "error"
      ? (["error", "Unreachable"] as const)
      : hasIssues
        ? (["warning", "Has warnings"] as const)
        : (["success", "Running"] as const);

  return (
    <Tile>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot tone={tone} label={label} />
          {service.url ? (
            <a
              href={service.url}
              target="_blank"
              rel="noreferrer"
              className="truncate text-base font-medium text-on-surface hover:underline"
            >
              {service.name}
            </a>
          ) : (
            <span className="truncate text-base font-medium text-on-surface">{service.name}</span>
          )}
        </span>
        {result.status === "ok" && result.data.version && (
          <span className="shrink-0 truncate text-xs text-on-surface-variant">v{result.data.version}</span>
        )}
      </div>

      {result.status === "error" &&
        (result.certificateChanged ? (
          <CertificateChanged message={result.message} {...result.certificateChanged} />
        ) : (
          <p className="text-sm break-words text-error">{result.message}</p>
        ))}

      {result.status === "ok" && (
        <>
          {result.data.stats.length > 0 && (
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-x-2 gap-y-3">
              {result.data.stats.map((stat) => (
                <div key={stat.label} className="min-w-0">
                  <dd className="text-[22px] leading-7 whitespace-nowrap text-on-surface tabular-nums">{stat.value}</dd>
                  <dt className="truncate text-xs text-on-surface-variant">{stat.label}</dt>
                </div>
              ))}
            </dl>
          )}
          {hasIssues && (
            <ul className="flex flex-col gap-1 rounded-lg bg-warning-container px-3 py-2 text-xs text-on-warning-container">
              {result.data.issues.map((issue) => (
                <li key={issue} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          )}
          {pending && <SeerrRequests result={pending} />}
        </>
      )}
      {service.actions.length > 0 && (
        <ServiceActions serviceKey={service.key} serviceName={service.name} actions={service.actions} />
      )}
    </Tile>
  );
}

// Shown on first load while the service answers (up to the request
// timeout). Refreshes keep the old tile on screen instead.
function ServiceTileFallback({ service }: { service: ServiceInfo }) {
  return (
    <Tile>
      <span className="flex min-w-0 items-center gap-2">
        <StatusDot tone="neutral" label="Loading" />
        <span className="truncate text-base font-medium text-on-surface">{service.name}</span>
      </span>
      <div className="h-10 animate-pulse rounded-lg bg-surface-container-highest" />
    </Tile>
  );
}

async function LoadedServiceTile({ serviceKey }: { serviceKey: string }) {
  const { status, pending } = await getServiceTile(serviceKey);
  return status ? <ServiceTile service={status} pending={pending} /> : null;
}

// A service tile that streams in on its own, so one slow service delays
// neither the other tiles nor the card around it.
export function ServiceSlot({ service }: { service: ServiceInfo }) {
  return (
    <Suspense fallback={<ServiceTileFallback service={service} />}>
      <LoadedServiceTile serviceKey={service.key} />
    </Suspense>
  );
}

export async function ServicesCard() {
  // Services matched to a Proxmox guest show under that guest instead; this
  // card keeps the rest and disappears when there are none. That is decided
  // from placement alone, before any service answers, and placement waits
  // at most briefly for Proxmox (getServicePlacement).
  const { unplacedServices, servicesByGuest } = await getServicePlacement();
  if (unplacedServices.length === 0) return null;

  return (
    <Card title="Services" subtitle={servicesByGuest.size > 0 ? "Not matched to a machine" : undefined}>
      <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {unplacedServices.map((service) => (
          <ServiceSlot key={service.key} service={service} />
        ))}
      </div>
    </Card>
  );
}
