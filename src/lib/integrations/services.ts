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
import { getImmichClient, immichSummary } from "./immich";
import { getJellyfinClient, jellyfinActions, jellyfinSummary } from "./jellyfin";
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
];

export type ServiceStatus = {
  key: string;
  name: string;
  url?: string;
  // Host SafeHub talks to (IP or name), used to place the service on a guest.
  host: string;
  result: IntegrationResult<ServiceSummary>;
  // Buttons for the tile (no run function: this goes to the browser).
  actions: { id: string; label: string; confirm?: string }[];
};

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

// All configured services in parallel; one slow or down service does not
// block the rest beyond the shared request timeout. Cached 5 s so several
// open tabs share one round of requests; saving settings starts a new cache.
const statusFetcher = perSettings(() =>
  cacheFor(5_000, async (): Promise<ServiceStatus[]> =>
    Promise.all(
      configuredServices().map(async ({ key, name, urlSetting, client, summary, actions = [] }) => ({
        key,
        name,
        url: urlSetting ? getSetting(urlSetting) : undefined,
        host: client.baseUrl.hostname,
        result: await attempt(() => summary(client)),
        actions: actions.map(({ id, label, confirm }) => ({ id, label, confirm })),
      })),
    ),
  ),
);

export function getServiceStatuses(): Promise<ServiceStatus[]> {
  return statusFetcher()();
}

// Runs one tile action. Only actions listed in the registry can run.
export async function runServiceAction(serviceKey: string, actionId: string): Promise<IntegrationResult<string | void>> {
  const service = configuredServices().find((candidate) => candidate.key === serviceKey);
  if (!service) return { status: "not-configured" };
  const action = service.actions?.find((candidate) => candidate.id === actionId);
  if (!action) return { status: "error", message: "Unknown action." };
  return attempt(() => action.run(service.client));
}
