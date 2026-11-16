import { CertificateChanged } from "@/components/certificate/certificate-changed";
import { ContainerChips } from "@/components/docker/container-chips";
import { Banner } from "@/components/ui/banner";
import { Card, Tile } from "@/components/ui/card";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { UsageBar } from "@/components/ui/usage-bar";
import { formatBytes, formatDuration, formatPercent, formatUptime } from "@/lib/format";
import { ServiceSlot } from "@/components/services/services-card";
import { getDashboardLayout } from "@/lib/dashboard";
import type { DockerContainer } from "@/lib/integrations/docker";
import { guestKey } from "@/lib/integrations/placement";
import type { GuestWithAddresses } from "@/lib/integrations/proxmox";
import type { ProxmoxNode } from "@/lib/integrations/proxmox/schemas";
import type { ServiceInfo } from "@/lib/integrations/services";
import { HistoryLink } from "@/components/history/history-link";
import { series } from "@/lib/metrics/series";
import { readTrends } from "@/lib/metrics/store";
import { GuestActions } from "./guest-actions";

function tone(status: string): StatusTone {
  if (status === "running" || status === "online") return "success";
  if (status === "stopped" || status === "offline") return "neutral";
  return "warning";
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

// One branch of the tree: a guest with its addresses, its controls, the
// Docker containers found on it and the services running on it. Actions sit
// on the right on wide screens and below on phones.
function GuestRow({
  guest,
  services,
  containers,
  containerHostAddress,
}: {
  guest: GuestWithAddresses;
  services: ServiceInfo[];
  containers: DockerContainer[];
  containerHostAddress?: string;
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
    <li className="relative flex flex-col gap-3 py-3 before:absolute before:top-6 before:-left-3 before:w-2.5 before:border-t-2 before:border-outline-variant sm:before:-left-5 sm:before:w-4">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
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
                <div
                  className={`text-xs ${guest.backupOverdue ? "font-medium text-warning" : "text-on-surface-variant"}`}
                >
                  {guest.backupAgeMs === null ? "No backup" : `Backup ${formatDuration(guest.backupAgeMs)} ago`}
                </div>
              )}
            </div>
          </div>
          {containers.length > 0 && (
            <div className="pl-[22px]">
              <ContainerChips containers={containers} hostAddress={containerHostAddress} />
            </div>
          )}
        </div>
        <GuestActions guest={guest} />
      </div>
      {services.length > 0 && (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {services.map((service) => (
            <ServiceSlot key={service.key} service={service} />
          ))}
        </div>
      )}
    </li>
  );
}

export async function ProxmoxCard() {
  const { proxmox: result, docker, dockerGuest, servicesByGuest, openedAt } = await getDashboardLayout();
  // Unconfigured: show nothing (the dashboard normally skips the card).
  if (result.status === "not-configured") return null;

  const containersOf = (guest: GuestWithAddresses) =>
    docker?.status === "ok" && dockerGuest === guestKey(guest) ? docker.data.containers : [];
  // Placement may come from an earlier answer (Proxmox was slow): services
  // placed under a guest this answer does not show (Proxmox failed, guest
  // removed) are listed below instead of disappearing.
  const shownGuests = new Set(result.status === "ok" ? result.data.guests.map(guestKey) : []);
  const servicesElsewhere = [...servicesByGuest]
    .filter(([key]) => !shownGuests.has(key))
    .flatMap(([, services]) => services);

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
                      services={servicesByGuest.get(guestKey(guest)) ?? []}
                      containers={containersOf(guest)}
                      // SafeHub runs on the Docker host, so without a known
                      // guest address the one it was opened at works too.
                      containerHostAddress={guest.addresses[0] ?? openedAt}
                    />
                  ))}
                </ul>
              ) : (
                <p className="px-4 pt-3 text-sm text-on-surface-variant">No VMs or containers.</p>
              )}
            </div>
          );
        })}

      {servicesElsewhere.length > 0 && (
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {servicesElsewhere.map((service) => (
            <ServiceSlot key={service.key} service={service} />
          ))}
        </div>
      )}

      {docker?.status === "error" && <Banner tone="error">Docker unreachable: {docker.message}</Banner>}
      {docker?.status === "ok" && !dockerGuest && (
        <Tile>
          <div className="text-base font-medium text-on-surface">Docker on {docker.data.name}</div>
          <p className="text-sm text-on-surface-variant">
            Not matched to a guest. For a VM, install and enable the QEMU guest agent and let the token read it
            (Settings, Connect with password again), or give the guest the same name as its host name.
          </p>
          <ContainerChips containers={docker.data.containers} hostAddress={openedAt} />
        </Tile>
      )}
    </Card>
  );
}
