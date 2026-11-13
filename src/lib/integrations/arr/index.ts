import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

// Sonarr, Radarr (API v3) and Prowlarr (API v1) share the same base API.

const statusSchema = z.object({ version: z.string() });
const healthSchema = z.array(z.object({ type: z.string(), message: z.string() }));
const pagedSchema = z.object({ totalRecords: z.number() });
const indexersSchema = z.array(z.object({ enable: z.boolean().default(true) }));
const indexerStatusSchema = z.array(z.object({ indexerId: z.number() }));

function arrClient(name: string, url?: string, apiKey?: string): HttpClient | null {
  return url && apiKey ? createHttpClient({ name, baseUrl: url, headers: { "X-Api-Key": apiKey } }) : null;
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

export const sonarrClient = arrClient("Sonarr", env.SONARR_URL, env.SONARR_API_KEY);
export const radarrClient = arrClient("Radarr", env.RADARR_URL, env.RADARR_API_KEY);
export const prowlarrClient = arrClient("Prowlarr", env.PROWLARR_URL, env.PROWLARR_API_KEY);

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
