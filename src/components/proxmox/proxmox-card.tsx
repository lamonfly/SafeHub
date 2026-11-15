import { headers } from "next/headers";
import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { ContainerChips } from "@/components/docker/container-chips";
import { hostnameOf } from "@/lib/request-host";
import { Banner } from "@/components/ui/banner";
import { Card, Tile } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { UsageBar } from "@/components/ui/usage-bar";
import { formatBytes, formatDuration, formatPercent, formatUptime } from "@/lib/format";
import { getDockerHost, isDockerConfigured, type DockerContainer } from "@/lib/integrations/docker";
import { placeDockerHost, placeServices, guestKey } from "@/lib/integrations/placement";
import { getProxmoxOverview, type GuestWithAddresses } from "@/lib/integrations/proxmox";
import type { ProxmoxNode } from "@/lib/integrations/proxmox/schemas";
import { getServiceStatuses, hasConfiguredServices, type ServiceStatus } from "@/lib/integrations/services";
import { HistoryLink } from "@/components/history/history-link";
import { series } from "@/lib/metrics/series";
import { readTrends } from "@/lib/metrics/store";
import { GuestActions } from "./guest-actions";

function tone(status: string): StatusTone {
  if (status === "running" || status === "online") return "success";
  if (status === "stopped" || status === "offline") return "neutral";
  return "warning";
}

function serviceTone(service: ServiceStatus): [StatusTone, string] {
  if (service.result.status === "error") return ["error", "Unreachable"];
  if (service.result.status === "ok" && service.result.data.issues.length > 0) return ["warning", "Has warnings"];
  return ["success", "Running"];
}

function NodeTile({ node, guestCount }: { node: ProxmoxNode; guestCount: number }) {
  const trends = readTrends([series.nodeCpu(node.node), series.nodeRam(node.node)]);
  return (
    <Tile>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-base font-medium text-on-surface">
          <StatusDot tone={tone(node.status)} label={node.status} />
          <HistoryLink href={`/history/node/${encodeURIComponent(node.node)}`}>{node.node}</HistoryLink>
          <span className="text-xs font-normal text-on-surface-variant">
            {guestCount} {guestCount === 1 ? "guest" : "guests"}
          </span>
        </span>
        <span className="text-xs text-on-surface-variant">up {formatUptime(node.uptime)}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <UsageBar
          label="CPU"
          percent={node.cpu * 100}
          detail={`${node.maxcpu} cores`}
          trend={trends.get(series.nodeCpu(node.node))}
        />
        <UsageBar
          label="RAM"
          percent={node.maxmem > 0 ? (node.mem / node.maxmem) * 100 : 0}
          detail={node.maxmem > 0 ? `${formatBytes(node.mem)} / ${formatBytes(node.maxmem)}` : undefined}
          trend={trends.get(series.nodeRam(node.node))}
        />
      </div>
    </Tile>
  );
}

// M3 assist-chip style link to a service running on a guest.
function ServiceChip({ service }: { service: ServiceStatus }) {
  const [chipTone, label] = serviceTone(service);
  const content = (
    <>
      <StatusDot tone={chipTone} label={label} />
      {service.name}
    </>
  );
  const className =
    "inline-flex h-8 items-center gap-2 rounded-lg border border-outline-variant px-3 text-sm text-on-surface";
  return service.url ? (
    <a href={service.url} target="_blank" rel="noreferrer" className={`${className} hover:bg-on-surface/8`}>
      {content}
    </a>
  ) : (
    <span className={className}>{content}</span>
  );
}

// One branch of the tree: a guest with its addresses, the services and
// Docker containers found on it, and its controls. Actions sit on the right on wide screens and below
// on phones.
function GuestRow({
  guest,
  services,
  containers,
}: {
  guest: GuestWithAddresses;
  services: ServiceStatus[];
  containers: DockerContainer[];
}) {
  const running = guest.status === "running";
  const details = running
    ? [
        `CPU ${formatPercent(guest.cpu)}`,
        guest.maxmem > 0 ? `RAM ${formatBytes(guest.mem)} / ${formatBytes(guest.maxmem)}` : undefined,
        `up ${formatUptime(guest.uptime)}`,
      ]
    : [guest.status];

  return (
    <li className="relative flex flex-col gap-2 py-3 before:absolute before:top-6 before:-left-3 before:w-2.5 before:border-t-2 before:border-outline-variant sm:before:-left-5 sm:before:w-4 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <StatusDot tone={tone(guest.status)} label={guest.status} className="mt-[7px]" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <HistoryLink
                href={`/history/guest/${encodeURIComponent(guest.node)}/${guest.vmid}`}
                className="truncate text-base text-on-surface"
              >
                {guest.name ?? `#${guest.vmid}`}
              </HistoryLink>
              <span className="shrink-0 rounded bg-secondary-container px-1.5 text-[11px] leading-4 font-medium text-on-secondary-container">
                {guest.type === "qemu" ? "VM" : "LXC"}
              </span>
              <span className="shrink-0 text-xs text-on-surface-variant tabular-nums">{guest.vmid}</span>
            </div>
            <div className="truncate text-sm text-on-surface-variant tabular-nums">
              {details.filter(Boolean).join(" · ")}
            </div>
            {guest.addresses.length > 0 && (
              <div className="truncate font-mono text-xs text-on-surface-variant">{guest.addresses.join(", ")}</div>
            )}
            {/* Only when backup data is available (undefined = unknown). */}
            {guest.backupAgeMs !== undefined && (
              <div className={`text-xs ${guest.backupOverdue ? "font-medium text-warning" : "text-on-surface-variant"}`}>
                {guest.backupAgeMs === null ? "No backup" : `Backup ${formatDuration(guest.backupAgeMs)} ago`}
              </div>
            )}
          </div>
        </div>
        {services.length > 0 && (
          <div className="flex flex-wrap gap-2 pl-[22px]">
            {services.map((service) => (
              <ServiceChip key={service.key} service={service} />
            ))}
          </div>
        )}
        {containers.length > 0 && (
          <div className="pl-[22px]">
            <ContainerChips containers={containers} hostAddress={guest.addresses[0]} />
          </div>
        )}
      </div>
      <GuestActions guest={guest} />
    </li>
  );
}

// Host name or IP the dashboard was opened at.
async function openedAtHost(): Promise<string | undefined> {
  return hostnameOf((await headers()).get("host"));
}

export async function ProxmoxCard() {
  const result = await getProxmoxOverview();
  // Unconfigured: show nothing (the dashboard normally skips the card).
  if (result.status === "not-configured") return null;

  const [placed, docker] = await Promise.all([
    result.status === "ok" && hasConfiguredServices()
      ? getServiceStatuses().then((statuses) => placeServices(result.data.guests, statuses))
      : new Map<string, ServiceStatus[]>(),
    isDockerConfigured() ? getDockerHost() : undefined,
  ]);
  // Guest running the Docker host; undefined when it cannot be told.
  const dockerGuest =
    result.status === "ok" && docker?.status === "ok"
      ? placeDockerHost(result.data.guests, docker.data, await openedAtHost())
      : undefined;
  const containersOf = (guest: GuestWithAddresses) =>
    docker?.status === "ok" && dockerGuest === guestKey(guest) ? docker.data.containers : [];

  return (
    <Card title="Proxmox">
      {result.status === "error" &&
        (result.certificateChanged ? (
          <CertificateChanged message={result.message} {...result.certificateChanged} />
        ) : (
          <Banner tone="error">Unreachable: {result.message}</Banner>
        ))}

      {result.status === "ok" &&
        result.data.nodes.map((node) => {
          const guests = result.data.guests.filter((guest) => guest.node === node.node);
          return (
            <div key={node.node} className="flex flex-col">
              <NodeTile node={node} guestCount={guests.length} />
              {guests.length > 0 ? (
                // Tree: guests hang off a line under their node.
                <ul className="ml-4 border-l-2 border-outline-variant pl-3 sm:ml-6 sm:pl-5">
                  {guests.map((guest) => (
                    <GuestRow
                      key={guestKey(guest)}
                      guest={guest}
                      services={placed.get(guestKey(guest)) ?? []}
                      containers={containersOf(guest)}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-4 pt-3 text-sm text-on-surface-variant">No VMs or containers.</p>
              )}
            </div>
          );
        })}

      {docker?.status === "error" && <Banner tone="error">Docker unreachable: {docker.message}</Banner>}
      {docker?.status === "ok" && !dockerGuest && (
        <Tile>
          <div className="text-base font-medium text-on-surface">Docker on {docker.data.name}</div>
          <p className="text-sm text-on-surface-variant">
            Not matched to a guest. For a VM, install the QEMU guest agent, or give the guest the same name as
            its host name.
          </p>
          <ContainerChips containers={docker.data.containers} hostAddress={await openedAtHost()} />
        </Tile>
      )}
    </Card>
  );
}
