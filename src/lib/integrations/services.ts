import "server-only";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import {
  getProwlarrClient,
  getRadarrClient,
  getSonarrClient,
  prowlarrActions,
  prowlarrSummary,
  radarrActions,
  radarrSummary,
  sonarrActions,
  sonarrSummary,
} from "./arr";
import { bazarrSummary, getBazarrClient } from "./bazarr";
import { cacheFor } from "./cache";
import type { HttpClient, ServiceAction, ServiceSummary } from "./http";
import { getGluetunClient, gluetunSummary } from "./gluetun";
import { getImmichClient, immichSummary } from "./immich";
import { getJellyfinClient, jellyfinActions, jellyfinSummary } from "./jellyfin";
import { getQbittorrentClient, qbittorrentActions, qbittorrentSummary } from "./qbittorrent";
import { attempt, type IntegrationResult } from "./result";
import { getSeerrClient, seerrSummary } from "./seerr";

type ServiceDefinition = {
  key: string;
  name: string;
  // Setting holding the tile's link.
  urlSetting?: string;
  client: () => HttpClient | null;
  summary: (client: HttpClient) => Promise<ServiceSummary>;
  actions?: ServiceAction[];
};

const services: ServiceDefinition[] = [
  { key: "jellyfin", name: "Jellyfin", urlSetting: "JELLYFIN_URL", client: getJellyfinClient, summary: jellyfinSummary, actions: jellyfinActions },
  { key: "seerr", name: "Seerr", urlSetting: "SEERR_URL", client: getSeerrClient, summary: seerrSummary },
  { key: "immich", name: "Immich", urlSetting: "IMMICH_URL", client: getImmichClient, summary: immichSummary },
  { key: "sonarr", name: "Sonarr", urlSetting: "SONARR_URL", client: getSonarrClient, summary: sonarrSummary, actions: sonarrActions },
  { key: "radarr", name: "Radarr", urlSetting: "RADARR_URL", client: getRadarrClient, summary: radarrSummary, actions: radarrActions },
  { key: "prowlarr", name: "Prowlarr", urlSetting: "PROWLARR_URL", client: getProwlarrClient, summary: prowlarrSummary, actions: prowlarrActions },
  { key: "bazarr", name: "Bazarr", urlSetting: "BAZARR_URL", client: getBazarrClient, summary: bazarrSummary },
  { key: "qbittorrent", name: "qBittorrent", urlSetting: "QBITTORRENT_URL", client: getQbittorrentClient, summary: qbittorrentSummary, actions: qbittorrentActions },
  // No urlSetting: the control server has no web page to link to.
  { key: "gluetun", name: "Gluetun", client: getGluetunClient, summary: gluetunSummary },
];

// What the dashboard knows about a service without asking it: enough to
// place its tile and draw its buttons.
export type ServiceInfo = {
  key: string;
  name: string;
  url?: string;
  // Host SafeHub talks to (IP or name), used to place the service on a guest.
  host: string;
  // Buttons for the tile (no run function: this goes to the browser).
  actions: { id: string; label: string; confirm?: string }[];
};

export type ServiceStatus = ServiceInfo & { result: IntegrationResult<ServiceSummary> };

// Services without settings are left out entirely; the dashboard only shows
// what is configured.
function configuredServices() {
  return services.flatMap((service) => {
    const client = service.client();
    return client ? [{ ...service, client }] : [];
  });
}

export function hasConfiguredServices(): boolean {
  return configuredServices().length > 0;
}

function infoOf({ key, name, urlSetting, client, actions = [] }: ReturnType<typeof configuredServices>[number]): ServiceInfo {
  return {
    key,
    name,
    url: urlSetting ? getSetting(urlSetting) : undefined,
    host: client.baseUrl.hostname,
    actions: actions
      .filter((action) => action.available?.() ?? true)
      .map(({ id, label, confirm }) => ({ id, label, confirm })),
  };
}

export function getServiceInfos(): ServiceInfo[] {
  return configuredServices().map(infoOf);
}

// One cache per service (5 s), so several open tabs share one round of
// requests and a slow service delays only its own tile. Saving settings
// starts new caches.
const summaryFetchers = perSettings(() => new Map<string, () => Promise<IntegrationResult<ServiceSummary>>>());

function fetchSummary(service: ReturnType<typeof configuredServices>[number]): Promise<IntegrationResult<ServiceSummary>> {
  const fetchers = summaryFetchers();
  let fetcher = fetchers.get(service.key);
  if (!fetcher) {
    fetcher = cacheFor(5_000, () => attempt(() => service.summary(service.client)));
    fetchers.set(service.key, fetcher);
  }
  return fetcher();
}

// One service's tile data; null when it is not (or no longer) configured.
export async function getServiceStatus(key: string): Promise<ServiceStatus | null> {
  const service = configuredServices().find((candidate) => candidate.key === key);
  return service ? { ...infoOf(service), result: await fetchSummary(service) } : null;
}

// All configured services in parallel; one slow or down service does not
// block the rest beyond the shared request timeout.
export function getServiceStatuses(): Promise<ServiceStatus[]> {
  return Promise.all(
    configuredServices().map(async (service) => ({ ...infoOf(service), result: await fetchSummary(service) })),
  );
}

// Runs one tile action. Only actions listed in the registry can run. The
// service's cached status is dropped so the tile shows the effect.
export async function runServiceAction(serviceKey: string, actionId: string): Promise<IntegrationResult<string | void>> {
  const service = configuredServices().find((candidate) => candidate.key === serviceKey);
  if (!service) return { status: "not-configured" };
  const action = service.actions?.find((candidate) => candidate.id === actionId && (candidate.available?.() ?? true));
  if (!action) return { status: "error", message: "Unknown action." };
  const result = await attempt(() => action.run(service.client));
  summaryFetchers().delete(service.key);
  return result;
}
