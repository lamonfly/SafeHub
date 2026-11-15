import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { resolveService } from "../discovery";
import { cacheFor } from "../cache";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";
import { attempt, type IntegrationResult } from "../result";
import { serviceTlsAgent } from "../tls";

// Works with Seerr, Jellyseerr and Overseerr (same API).
const statusSchema = z.object({ version: z.string() });
const requestCountSchema = z.object({
  pending: z.number().default(0),
  processing: z.number().default(0),
  available: z.number().default(0),
});

// Explicit settings win; otherwise use what auto-setup found in ./appdata.
export const getSeerrClient = perSettings((): HttpClient | null => {
  const service = resolveService("seerr", getSetting("SEERR_URL"), getSetting("SEERR_API_KEY"));
  return service
    ? createHttpClient({ name: "Seerr", baseUrl: service.url, headers: { "X-Api-Key": service.apiKey }, dispatcher: serviceTlsAgent("seerr") })
    : null;
});

export async function seerrSummary(client: HttpClient): Promise<ServiceSummary> {
  const [status, requests] = await Promise.all([
    client.get("api/v1/status", statusSchema),
    client.get("api/v1/request/count", requestCountSchema),
  ]);
  return {
    version: status.version,
    stats: [
      { label: "Pending", value: requests.pending },
      { label: "Processing", value: requests.processing },
      { label: "Available", value: requests.available },
    ],
    issues: [],
  };
}

// Pending requests, with Approve and Decline on the dashboard. The request
// list holds only TMDB ids; titles come from the movie / tv endpoints and
// rarely change, so they are cached per settings.
const requestPageSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      type: z.enum(["movie", "tv"]),
      createdAt: z.string(),
      is4k: z.boolean().default(false),
      media: z.object({ tmdbId: z.number() }),
      requestedBy: z.object({ displayName: z.string().optional() }).nullish(),
      seasons: z.array(z.object({ seasonNumber: z.number() })).default([]),
    }),
  ),
});

const titleSchema = z.object({
  title: z.string().optional(), // movies
  name: z.string().optional(), // series
  releaseDate: z.string().optional(),
  firstAirDate: z.string().optional(),
});

export type SeerrRequest = {
  id: number;
  type: "movie" | "tv";
  title: string;
  year?: string;
  requestedBy?: string;
  createdAt: string;
  is4k: boolean;
  seasons: number[];
};

export const PENDING_LIMIT = 10;

const titleCache = perSettings(() => new Map<string, Promise<{ title: string; year?: string }>>());

function titleOf(client: HttpClient, type: "movie" | "tv", tmdbId: number) {
  const cache = titleCache();
  if (cache.size > 500) cache.clear(); // stays small; a full reset is enough
  const key = `${type}/${tmdbId}`;
  let title = cache.get(key);
  if (!title) {
    title = client.get(`api/v1/${type}/${tmdbId}`, titleSchema).then((details) => ({
      title: details.title ?? details.name ?? `TMDB ${tmdbId}`,
      year: (details.releaseDate ?? details.firstAirDate)?.slice(0, 4) || undefined,
    }));
    // A failed lookup is asked again next time, not cached.
    title.catch(() => cache.delete(key));
    cache.set(key, title);
  }
  return title.catch(() => ({ title: `TMDB ${tmdbId}`, year: undefined }));
}

export async function getPendingRequests(client: HttpClient): Promise<SeerrRequest[]> {
  const page = await client.get(`api/v1/request?filter=pending&sort=added&take=${PENDING_LIMIT}`, requestPageSchema);
  return Promise.all(
    page.results.map(async (request) => ({
      id: request.id,
      type: request.type,
      ...(await titleOf(client, request.type, request.media.tmdbId)),
      requestedBy: request.requestedBy?.displayName,
      createdAt: request.createdAt,
      is4k: request.is4k,
      seasons: request.seasons.map((season) => season.seasonNumber),
    })),
  );
}

// Input for Approve / Decline; the id ends up in the request URL.
export const requestDecisionSchema = z.object({
  id: z.number().int().positive(),
  decision: z.enum(["approve", "decline"]),
});
export type RequestDecision = z.infer<typeof requestDecisionSchema>;

export async function decideRequest(client: HttpClient, { id, decision }: RequestDecision): Promise<void> {
  await client.post(`api/v1/request/${id}/${decision}`, z.unknown());
}

// Cached 5 s like the tiles, so several open tabs share one request. A
// decision starts a new cache, so the list never shows it as still pending.
let pendingVersion = 0;
const pendingFetcher = perSettings(() => {
  let builtFor = -1;
  let fetcher: (client: HttpClient) => Promise<SeerrRequest[]> = getPendingRequests;
  return (client: HttpClient) => {
    if (builtFor !== pendingVersion) {
      fetcher = cacheFor(5_000, getPendingRequests);
      builtFor = pendingVersion;
    }
    return fetcher(client);
  };
});

export async function getSeerrPendingRequests(): Promise<IntegrationResult<SeerrRequest[]>> {
  const client = getSeerrClient();
  if (!client) return { status: "not-configured" };
  return attempt(() => pendingFetcher()(client));
}

export async function decideSeerrRequest(input: RequestDecision): Promise<IntegrationResult<void>> {
  const client = getSeerrClient();
  if (!client) return { status: "not-configured" };
  return attempt(async () => {
    await decideRequest(client, input);
    pendingVersion++;
  });
}
