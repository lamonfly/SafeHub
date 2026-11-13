import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { cacheFor } from "../cache";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

const versionSchema = z.object({ major: z.number(), minor: z.number(), patch: z.number() });
const statisticsSchema = z.object({
  photos: z.number(),
  videos: z.number(),
  usage: z.number(), // bytes
});

export const immichClient: HttpClient | null =
  env.IMMICH_URL && env.IMMICH_API_KEY
    ? createHttpClient({
        name: "Immich",
        baseUrl: env.IMMICH_URL,
        headers: { "x-api-key": env.IMMICH_API_KEY },
      })
    : null;

// Counting a large library is expensive for Immich; once a minute is enough.
const getStatistics = cacheFor(60_000, (client: HttpClient) =>
  client.get("api/server/statistics", statisticsSchema),
);

export async function immichSummary(client: HttpClient): Promise<ServiceSummary> {
  const version = await client.get("api/server/version", versionSchema);
  // Statistics need an admin key (or the server.statistics permission);
  // still show the version when they are not allowed.
  const statistics = await getStatistics(client).catch((error: Error) => error);

  return {
    version: `${version.major}.${version.minor}.${version.patch}`,
    stats:
      statistics instanceof Error
        ? []
        : [
            { label: "Photos", value: statistics.photos.toLocaleString("en") },
            { label: "Videos", value: statistics.videos.toLocaleString("en") },
            { label: "Storage", value: formatBytes(statistics.usage) },
          ],
    issues:
      statistics instanceof Error ? [`Statistics unavailable (${statistics.message})`] : [],
  };
}
