import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

// Works with Seerr, Jellyseerr and Overseerr (same API).
const statusSchema = z.object({ version: z.string() });
const requestCountSchema = z.object({
  pending: z.number().default(0),
  processing: z.number().default(0),
  available: z.number().default(0),
});

export const seerrClient: HttpClient | null =
  env.SEERR_URL && env.SEERR_API_KEY
    ? createHttpClient({
        name: "Seerr",
        baseUrl: env.SEERR_URL,
        headers: { "X-Api-Key": env.SEERR_API_KEY },
      })
    : null;

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
