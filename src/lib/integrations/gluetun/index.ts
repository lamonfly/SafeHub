import "server-only";
import { z } from "zod";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { createHttpClient, type HttpClient, type ServiceSummary } from "../http";
import { serviceTlsAgent } from "../tls";

// Gluetun's HTTP control server (port 8000 inside the container). Since
// Gluetun 3.40 its routes need an auth role; SafeHub sends an API key.

const vpnStatusSchema = z.object({ status: z.string() });
const publicIpSchema = z.object({
  public_ip: z.string().default(""),
  country: z.string().default(""),
  city: z.string().default(""),
});
const portForwardSchema = z.object({ port: z.number().default(0) });

export const getGluetunClient = perSettings((): HttpClient | null => {
  const url = getSetting("GLUETUN_URL");
  const apiKey = getSetting("GLUETUN_API_KEY");
  return url
    ? createHttpClient({
        name: "Gluetun",
        baseUrl: url,
        headers: apiKey ? { "X-API-Key": apiKey } : {},
        dispatcher: serviceTlsAgent("gluetun"),
      })
    : null;
});

function explainUnauthorized(error: unknown): never {
  if (error instanceof Error && / 401\b/.test(error.message)) {
    throw new Error("Gluetun refused the request (401). Give SafeHub an API key role in Gluetun's control server auth config.");
  }
  throw error;
}

// The port the VPN provider forwards, or null when there is none (Gluetun
// answers 0). Newer Gluetun serves /v1/portforward; older versions only
// /v1/openvpn/portforwarded. Throws when neither can be read.
export async function getForwardedPort(client: HttpClient): Promise<number | null> {
  const { port } = await client.get("v1/portforward", portForwardSchema).catch((error: unknown) => {
    if (error instanceof Error && / 404\b/.test(error.message)) {
      return client.get("v1/openvpn/portforwarded", portForwardSchema);
    }
    return explainUnauthorized(error);
  });
  return port > 0 ? port : null;
}

// A stopped or reconnecting VPN is an error: the tile turns red and the
// service alert opens after the usual grace period.
export async function gluetunSummary(client: HttpClient): Promise<ServiceSummary> {
  const vpn = await client.get("v1/vpn/status", vpnStatusSchema).catch(explainUnauthorized);
  if (vpn.status !== "running") throw new Error(`VPN is ${vpn.status}.`);

  const [publicIp, forwardedPort] = await Promise.all([
    client.get("v1/publicip/ip", publicIpSchema).catch(explainUnauthorized),
    // Only some providers forward a port, and the route may not be in the
    // API key's role: leave the stat out instead of failing the tile.
    getForwardedPort(client).catch(() => null),
  ]);
  const location = [publicIp.city, publicIp.country].filter(Boolean).join(", ");
  return {
    stats: [
      { label: "Public IP", value: publicIp.public_ip || "unknown" },
      ...(location ? [{ label: "Location", value: location }] : []),
      ...(forwardedPort ? [{ label: "Forwarded port", value: forwardedPort }] : []),
    ],
    issues: publicIp.public_ip ? [] : ["VPN is running but has no public IP yet."],
  };
}
