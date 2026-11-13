import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

const infoSchema = z.object({ Version: z.string() });
const sessionsSchema = z.array(z.object({ NowPlayingItem: z.unknown().optional() }));
const countsSchema = z.object({
  MovieCount: z.number().default(0),
  SeriesCount: z.number().default(0),
});

export const jellyfinClient: HttpClient | null =
  env.JELLYFIN_URL && env.JELLYFIN_API_KEY
    ? createHttpClient({
        name: "Jellyfin",
        baseUrl: env.JELLYFIN_URL,
        headers: { Authorization: `MediaBrowser Token="${env.JELLYFIN_API_KEY}"` },
      })
    : null;

export async function jellyfinSummary(client: HttpClient): Promise<ServiceSummary> {
  const [info, sessions, counts] = await Promise.all([
    client.get("System/Info", infoSchema),
    client.get("Sessions?activeWithinSeconds=600", sessionsSchema),
    client.get("Items/Counts", countsSchema),
  ]);
  return {
    version: info.Version,
    stats: [
      { label: "Streaming", value: sessions.filter((session) => session.NowPlayingItem).length },
      { label: "Movies", value: counts.MovieCount },
      { label: "Series", value: counts.SeriesCount },
    ],
    issues: [],
  };
}
