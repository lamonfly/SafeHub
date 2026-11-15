import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { createHttpClient, type HttpClient, type ServiceAction, type ServiceSummary } from "../http";
import { serviceTlsAgent } from "../tls";

const infoSchema = z.object({ Version: z.string() });
const sessionsSchema = z.array(z.object({ NowPlayingItem: z.unknown().optional() }));
const countsSchema = z.object({
  MovieCount: z.number().default(0),
  SeriesCount: z.number().default(0),
});

// URLs copied from the browser often end in the web app's path
// (http://host:8096/web/#/home); the API lives one level up.
export function normalizeJellyfinUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/web(\/.*)?$/, "/");
  return parsed.href;
}

export const getJellyfinClient = perSettings((): HttpClient | null => {
  const url = normalizeJellyfinUrl(getSetting("JELLYFIN_URL"));
  const apiKey = getSetting("JELLYFIN_API_KEY");
  return url && apiKey
    ? createHttpClient({
        name: "Jellyfin",
        baseUrl: url,
        headers: { Authorization: `MediaBrowser Token="${apiKey}"` },
        dispatcher: serviceTlsAgent("jellyfin"),
      })
    : null;
});

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

export const jellyfinActions: ServiceAction[] = [
  {
    id: "scan-library",
    label: "Scan libraries",
    run: async (client) => {
      await client.post("Library/Refresh", z.unknown());
      return "Scan started.";
    },
  },
];
