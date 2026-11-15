import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { formatBytes } from "@/lib/format";
import { cacheFor } from "../cache";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";
import { serviceTlsAgent } from "../tls";

const versionSchema = z.object({ major: z.number(), minor: z.number(), patch: z.number() });
const statisticsSchema = z.object({
  photos: z.number(),
  videos: z.number(),
  usage: z.number(), // bytes
});

export const getImmichClient = perSettings((): HttpClient | null => {
  const url = getSetting("IMMICH_URL");
  const apiKey = getSetting("IMMICH_API_KEY");
  return url && apiKey
    ? createHttpClient({ name: "Immich", baseUrl: url, headers: { "x-api-key": apiKey }, dispatcher: serviceTlsAgent("immich") })
    : null;
});

// Counting a large library is expensive for Immich; once a minute is enough.
// Per settings, so a new URL or key never shows the old server's numbers.
const statisticsFetcher = perSettings(() =>
  cacheFor(60_000, (client: HttpClient) => client.get("api/server/statistics", statisticsSchema)),
);

export async function immichSummary(client: HttpClient): Promise<ServiceSummary> {
  const version = await client.get("api/server/version", versionSchema);
  // Statistics need an admin key (or the server.statistics permission);
  // still show the version when they are not allowed.
  const statistics = await statisticsFetcher()(client).catch((error: Error) => error);

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
      statistics instanceof Error
        ? [
            / 403 /.test(statistics.message)
              ? "Statistics need an admin API key with the server.statistics permission"
              : `Statistics unavailable (${statistics.message})`,
          ]
        : [],
  };
}
