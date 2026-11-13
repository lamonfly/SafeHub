import "server-only";
import { env } from "@/lib/env";
import {
  prowlarrClient,
  prowlarrSummary,
  radarrClient,
  radarrSummary,
  sonarrClient,
  sonarrSummary,
} from "./arr";
import { bazarrClient, bazarrSummary } from "./bazarr";
import { cacheFor } from "./cache";
import { caddyClient, caddySummary } from "./caddy";
import type { HttpClient, ServiceSummary } from "./http";
import { immichClient, immichSummary } from "./immich";
import { jellyfinClient, jellyfinSummary } from "./jellyfin";
import { attempt, type IntegrationResult } from "./result";
import { seerrClient, seerrSummary } from "./seerr";

type ServiceDefinition = {
  key: string;
  name: string;
  // Link for the tile title; the admin API of Caddy is not a web UI.
  url?: string;
  client: HttpClient | null;
  summary: (client: HttpClient) => Promise<ServiceSummary>;
};

const services: ServiceDefinition[] = [
  { key: "jellyfin", name: "Jellyfin", url: env.JELLYFIN_URL, client: jellyfinClient, summary: jellyfinSummary },
  { key: "seerr", name: "Seerr", url: env.SEERR_URL, client: seerrClient, summary: seerrSummary },
  { key: "immich", name: "Immich", url: env.IMMICH_URL, client: immichClient, summary: immichSummary },
  { key: "sonarr", name: "Sonarr", url: env.SONARR_URL, client: sonarrClient, summary: sonarrSummary },
  { key: "radarr", name: "Radarr", url: env.RADARR_URL, client: radarrClient, summary: radarrSummary },
  { key: "prowlarr", name: "Prowlarr", url: env.PROWLARR_URL, client: prowlarrClient, summary: prowlarrSummary },
  { key: "bazarr", name: "Bazarr", url: env.BAZARR_URL, client: bazarrClient, summary: bazarrSummary },
  { key: "caddy", name: "Caddy", client: caddyClient, summary: caddySummary },
];

export type ServiceStatus = {
  key: string;
  name: string;
  url?: string;
  result: IntegrationResult<ServiceSummary>;
};

// All services in parallel; one slow or down service does not block the rest
// beyond the shared request timeout. Cached 5 s so several open tabs share
// one round of requests.
export const getServiceStatuses = cacheFor(5_000, async (): Promise<ServiceStatus[]> =>
  Promise.all(
    services.map(async ({ key, name, url, client, summary }) => ({
      key,
      name,
      url,
      result: client
        ? await attempt(() => summary(client))
        : ({ status: "not-configured" } as const),
    })),
  ),
);
