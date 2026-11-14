import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { resolveService } from "../discovery";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

const statusSchema = z.object({ data: z.object({ bazarr_version: z.string() }) });
// Counts of items missing subtitles.
const badgesSchema = z.object({
  episodes: z.number().default(0),
  movies: z.number().default(0),
});
const healthSchema = z.object({
  data: z.array(z.object({ object: z.string(), issue: z.string() })).default([]),
});

// Explicit settings win; otherwise use what auto-setup found in ./appdata.
const service = resolveService("bazarr", env.BAZARR_URL, env.BAZARR_API_KEY);

export const bazarrClient: HttpClient | null = service
  ? createHttpClient({
      name: "Bazarr",
      baseUrl: service.url,
      headers: { "X-API-KEY": service.apiKey },
    })
  : null;

export async function bazarrSummary(client: HttpClient): Promise<ServiceSummary> {
  const [status, badges, health] = await Promise.all([
    client.get("api/system/status", statusSchema),
    client.get("api/badges", badgesSchema),
    client.get("api/system/health", healthSchema),
  ]);
  return {
    version: status.data.bazarr_version,
    stats: [
      { label: "Missing episodes", value: badges.episodes },
      { label: "Missing movies", value: badges.movies },
    ],
    issues: health.data.map((item) => `${item.object}: ${item.issue}`),
  };
}
