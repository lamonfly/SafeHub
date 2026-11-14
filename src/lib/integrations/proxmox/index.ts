import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { perSettings } from "@/lib/settings/memo";
import { getFlag, getSetting } from "@/lib/settings/store";
import { createHttpClient, type HttpClient } from "../http";
import { errorResult, type IntegrationResult } from "../result";
import { createTlsAgent } from "../tls";
import { getGuestNetworks, type GuestNetworks } from "./addresses";
import {
  guestSchema,
  responseSchema,
  nodeSchema,
  type GuestActionInput,
  type ProxmoxGuest,
  type ProxmoxNode,
} from "./schemas";

// TLS agent for any Proxmox request, including the connect wizard.
export function proxmoxTlsAgent() {
  return createTlsAgent({
    pinName: "proxmox",
    caCertPath: env.PROXMOX_CA_CERT_PATH,
    allowSelfSigned: getFlag("PROXMOX_ALLOW_SELF_SIGNED"),
  });
}

const getClient = perSettings((): HttpClient | null => {
  const url = getSetting("PROXMOX_URL");
  const tokenId = getSetting("PROXMOX_TOKEN_ID");
  const tokenSecret = getSetting("PROXMOX_TOKEN_SECRET");
  if (!url || !tokenId || !tokenSecret) return null;
  return createHttpClient({
    name: "Proxmox",
    baseUrl: new URL("/api2/json/", url).href,
    headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` },
    dispatcher: proxmoxTlsAgent(),
  });
});

// The dashboard hides the Proxmox card when this is false.
export function isProxmoxConfigured(): boolean {
  return getClient() !== null;
}

// Proxmox wraps every response in { data }. Errors carry the reason in the
// status text, e.g. "Permission check failed".
async function request<T extends z.ZodType>(
  client: HttpClient,
  method: "get" | "post",
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  return schema.parse((await client[method](path, responseSchema)).data);
}

export type GuestWithAddresses = ProxmoxGuest & GuestNetworks;

export type ProxmoxOverview = {
  nodes: ProxmoxNode[];
  guests: GuestWithAddresses[];
};

export async function getProxmoxOverview(): Promise<IntegrationResult<ProxmoxOverview>> {
  const client = getClient();
  if (!client) return { status: "not-configured" };
  try {
    const [nodes, guests] = await Promise.all([
      request(client, "get", "nodes", z.array(nodeSchema)),
      request(client, "get", "cluster/resources?type=vm", z.array(guestSchema)),
    ]);
    const visible = guests.filter((guest) => !guest.template).sort((a, b) => a.vmid - b.vmid);
    const withAddresses = await Promise.all(
      visible.map(async (guest) => ({ ...guest, ...(await getGuestNetworks(client, guest)) })),
    );
    return {
      status: "ok",
      data: { nodes: nodes.sort((a, b) => a.node.localeCompare(b.node)), guests: withAddresses },
    };
  } catch (error) {
    return errorResult(error);
  }
}

// Starts a Proxmox task and returns its UPID. The task runs asynchronously;
// the guest status changes once Proxmox finishes it.
export async function runGuestAction({
  node,
  type,
  vmid,
  action,
}: GuestActionInput): Promise<IntegrationResult<string>> {
  const client = getClient();
  if (!client) return { status: "not-configured" };
  try {
    const upid = await request(
      client,
      "post",
      `nodes/${node}/${type}/${vmid}/status/${action}`,
      z.string(),
    );
    return { status: "ok", data: upid };
  } catch (error) {
    return errorResult(error);
  }
}
