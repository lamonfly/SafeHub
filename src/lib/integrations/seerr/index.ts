import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { resolveService } from "../discovery";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";
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
