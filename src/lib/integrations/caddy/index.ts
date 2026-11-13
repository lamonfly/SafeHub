import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";

// Caddy's admin API has no auth. It only reports upstreams of reverse_proxy
// handlers; `fails` counts recent failed requests (passive health checks).
const upstreamsSchema = z.array(
  z.object({
    address: z.string(),
    num_requests: z.number().default(0),
    fails: z.number().default(0),
  }),
);

export const caddyClient: HttpClient | null = env.CADDY_ADMIN_URL
  ? createHttpClient({ name: "Caddy", baseUrl: env.CADDY_ADMIN_URL })
  : null;

export async function caddySummary(client: HttpClient): Promise<ServiceSummary> {
  const upstreams = await client.get("reverse_proxy/upstreams", upstreamsSchema);
  const failing = upstreams.filter((upstream) => upstream.fails > 0);
  return {
    stats: [
      { label: "Upstreams", value: upstreams.length },
      { label: "Active requests", value: upstreams.reduce((sum, u) => sum + u.num_requests, 0) },
    ],
    issues: failing.map((upstream) => `${upstream.address}: ${upstream.fails} recent failures`),
  };
}
