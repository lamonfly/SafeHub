import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { getDockerHost, isDockerConfigured, type DockerHost } from "@/lib/integrations/docker";
import { placeDockerHost, placeServices } from "@/lib/integrations/placement";
import { getCachedProxmoxOverview, type ProxmoxOverview } from "@/lib/integrations/proxmox";
import type { IntegrationResult } from "@/lib/integrations/result";
import { getSeerrPendingRequests, type SeerrRequest } from "@/lib/integrations/seerr";
import { getServiceInfos, getServiceStatus, type ServiceInfo, type ServiceStatus } from "@/lib/integrations/services";
import { hostnameOf } from "@/lib/request-host";

// Where each service shows: under a Proxmox guest, or in the Services card.
export type ServicePlacement = {
  // Guest running the Docker host; undefined when it cannot be told.
  dockerGuest?: string;
  // Services shown under the guest they run on, by guestKey.
  servicesByGuest: Map<string, ServiceInfo[]>;
  // Services not matched to any guest: they stay in the Services card.
  unplacedServices: ServiceInfo[];
  // Host name or IP the dashboard was opened at.
  openedAt?: string;
};

export type DashboardLayout = ServicePlacement & {
  proxmox: IntegrationResult<ProxmoxOverview>;
  docker?: IntegrationResult<DockerHost>;
};

// How long placement waits for Proxmox and Docker. A Proxmox that is down
// takes up to its 5 s timeout to fail (failures are not cached), and the
// Services card must not wait that long on every refresh.
export const PLACEMENT_WAIT_MS = 1_500;

// Last finished answers, used for placement while a new one is slow.
let lastProxmox: IntegrationResult<ProxmoxOverview> | undefined;
let lastDocker: IntegrationResult<DockerHost> | undefined;

// The full answers, asked once per request. Only the Proxmox card waits for
// them; placement waits at most PLACEMENT_WAIT_MS.
const getSources = cache(() => {
  const proxmox = getCachedProxmoxOverview();
  const docker = isDockerConfigured() ? getDockerHost() : Promise.resolve(undefined);
  // Both never reject (IntegrationResult); the catch only keeps a bug from
  // becoming an unhandled rejection here.
  proxmox.then((result) => (lastProxmox = result)).catch(() => undefined);
  docker.then((result) => (lastDocker = result)).catch(() => undefined);
  return { proxmox, docker };
});

async function withinTimeLimit<T>(promise: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Placement, shared by the Proxmox and Services cards (cached per request).
// It needs only the services' addresses, not their status, so the guest tree
// never waits for a slow service: each tile loads its own data
// (getServiceTile) inside its own Suspense boundary. When Proxmox or Docker
// is slow, the last answer is used, and without one every service stays in
// the Services card.
export const getServicePlacement = cache(async (): Promise<ServicePlacement> => {
  const sources = getSources();
  const [proxmox, docker, openedAt] = await Promise.all([
    withinTimeLimit(sources.proxmox, PLACEMENT_WAIT_MS, () => lastProxmox),
    withinTimeLimit(sources.docker, PLACEMENT_WAIT_MS, () => lastDocker),
    headers().then((list) => hostnameOf(list.get("host"))),
  ]);
  const services = getServiceInfos();

  const placement: ServicePlacement = { servicesByGuest: new Map(), unplacedServices: services, openedAt };
  if (proxmox?.status !== "ok") return placement;

  const { guests } = proxmox.data;
  placement.dockerGuest = docker?.status === "ok" ? placeDockerHost(guests, docker.data, openedAt) : undefined;
  placement.servicesByGuest = await placeServices(
    guests,
    services,
    placement.dockerGuest && docker?.status === "ok"
      ? { guest: placement.dockerGuest, containers: docker.data.containers }
      : undefined,
  );
  const placed = new Set([...placement.servicesByGuest.values()].flat().map((service) => service.key));
  placement.unplacedServices = services.filter((service) => !placed.has(service.key));
  return placement;
});

// Everything the Proxmox card shows: the full answers plus placement.
export const getDashboardLayout = cache(async (): Promise<DashboardLayout> => {
  const sources = getSources();
  const [placement, proxmox, docker] = await Promise.all([getServicePlacement(), sources.proxmox, sources.docker]);
  // The Docker host's guest from the fresh answer (placement may have used
  // an older one).
  const dockerGuest =
    proxmox.status === "ok" && docker?.status === "ok"
      ? placeDockerHost(proxmox.data.guests, docker.data, placement.openedAt)
      : placement.dockerGuest;
  return { ...placement, dockerGuest, proxmox, docker };
});

export type ServiceTileData = {
  // null when the service is no longer configured.
  status: ServiceStatus | null;
  // Seerr's pending requests, only when Seerr itself answered (a down Seerr
  // already shows its error).
  pending?: IntegrationResult<SeerrRequest[]>;
};

// One tile's data, cached per request.
export const getServiceTile = cache(async (key: string): Promise<ServiceTileData> => {
  const [status, pending] = await Promise.all([
    getServiceStatus(key),
    key === "seerr" ? getSeerrPendingRequests() : undefined,
  ]);
  return { status, pending: status?.result.status === "ok" ? pending : undefined };
});
