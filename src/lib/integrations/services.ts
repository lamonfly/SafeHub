import "server-only";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import {
  getProwlarrClient,
  getRadarrClient,
  getSonarrClient,
  prowlarrSummary,
  radarrSummary,
  sonarrSummary,
} from "./arr";
import { bazarrSummary, getBazarrClient } from "./bazarr";
import { cacheFor } from "./cache";
import { caddySummary, getCaddyClient } from "./caddy";
import type { HttpClient, ServiceSummary } from "./http";
import { getImmichClient, immichSummary } from "./immich";
import { getJellyfinClient, jellyfinSummary } from "./jellyfin";
import { attempt, type IntegrationResult } from "./result";
import { getSeerrClient, seerrSummary } from "./seerr";

type ServiceDefinition = {
  key: string;
  name: string;
  // Setting holding the tile's link; Caddy's admin API is not a web UI.
  urlSetting?: string;
  client: () => HttpClient | null;
  summary: (client: HttpClient) => Promise<ServiceSummary>;
};

const services: ServiceDefinition[] = [
  { key: "jellyfin", name: "Jellyfin", urlSetting: "JELLYFIN_URL", client: getJellyfinClient, summary: jellyfinSummary },
  { key: "seerr", name: "Seerr", urlSetting: "SEERR_URL", client: getSeerrClient, summary: seerrSummary },
  { key: "immich", name: "Immich", urlSetting: "IMMICH_URL", client: getImmichClient, summary: immichSummary },
  { key: "sonarr", name: "Sonarr", urlSetting: "SONARR_URL", client: getSonarrClient, summary: sonarrSummary },
  { key: "radarr", name: "Radarr", urlSetting: "RADARR_URL", client: getRadarrClient, summary: radarrSummary },
  { key: "prowlarr", name: "Prowlarr", urlSetting: "PROWLARR_URL", client: getProwlarrClient, summary: prowlarrSummary },
  { key: "bazarr", name: "Bazarr", urlSetting: "BAZARR_URL", client: getBazarrClient, summary: bazarrSummary },
  { key: "caddy", name: "Caddy", client: getCaddyClient, summary: caddySummary },
];

export type ServiceStatus = {
  key: string;
  name: string;
  url?: string;
  // Host SafeHub talks to (IP or name), used to place the service on a guest.
  host: string;
  result: IntegrationResult<ServiceSummary>;
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
      configuredServices().map(async ({ key, name, urlSetting, client, summary }) => ({
        key,
        name,
        url: urlSetting ? getSetting(urlSetting) : undefined,
        host: client.baseUrl.hostname,
        result: await attempt(() => summary(client)),
      })),
    ),
  ),
);

export function getServiceStatuses(): Promise<ServiceStatus[]> {
  return statusFetcher()();
}
