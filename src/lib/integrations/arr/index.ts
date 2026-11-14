import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { resolveService, type DiscoverableApp } from "../discovery";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

// Sonarr, Radarr (API v3) and Prowlarr (API v1) share the same base API.

const statusSchema = z.object({ version: z.string() });
const healthSchema = z.array(z.object({ type: z.string(), message: z.string() }));
const pagedSchema = z.object({ totalRecords: z.number() });
const indexersSchema = z.array(z.object({ enable: z.boolean().default(true) }));
const indexerStatusSchema = z.array(z.object({ indexerId: z.number() }));

// Explicit settings win; otherwise use what auto-setup found in ./appdata.
function arrClient(
  name: string,
  app: DiscoverableApp,
  prefix: string,
): HttpClient | null {
  const service = resolveService(app, getSetting(`${prefix}_URL`), getSetting(`${prefix}_API_KEY`));
  return service
    ? createHttpClient({ name, baseUrl: service.url, headers: { "X-Api-Key": service.apiKey } })
    : null;
}

async function baseSummary(client: HttpClient, api: string) {
  const [status, health] = await Promise.all([
    client.get(`${api}/system/status`, statusSchema),
    client.get(`${api}/health`, healthSchema),
  ]);
  return {
    version: status.version,
    issues: health.filter((item) => item.type !== "ok" && item.type !== "notice").map((item) => item.message),
  };
}

export const getSonarrClient = perSettings(() => arrClient("Sonarr", "sonarr", "SONARR"));
export const getRadarrClient = perSettings(() => arrClient("Radarr", "radarr", "RADARR"));
export const getProwlarrClient = perSettings(() => arrClient("Prowlarr", "prowlarr", "PROWLARR"));

export async function sonarrSummary(client: HttpClient): Promise<ServiceSummary> {
  const [base, queue, missing] = await Promise.all([
    baseSummary(client, "api/v3"),
    client.get("api/v3/queue?pageSize=1", pagedSchema),
    client.get("api/v3/wanted/missing?pageSize=1&monitored=true", pagedSchema),
  ]);
  return {
    ...base,
    stats: [
      { label: "Queue", value: queue.totalRecords },
      { label: "Missing", value: missing.totalRecords },
    ],
  };
}

export async function radarrSummary(client: HttpClient): Promise<ServiceSummary> {
  const [base, queue] = await Promise.all([
    baseSummary(client, "api/v3"),
    client.get("api/v3/queue?pageSize=1", pagedSchema),
  ]);
  return { ...base, stats: [{ label: "Queue", value: queue.totalRecords }] };
}

export async function prowlarrSummary(client: HttpClient): Promise<ServiceSummary> {
  const [base, indexers, failing] = await Promise.all([
    baseSummary(client, "api/v1"),
    client.get("api/v1/indexer", indexersSchema),
    client.get("api/v1/indexerstatus", indexerStatusSchema),
  ]);
  return {
    ...base,
    stats: [
      { label: "Indexers", value: indexers.filter((indexer) => indexer.enable).length },
      { label: "Failing", value: failing.length },
    ],
  };
}
