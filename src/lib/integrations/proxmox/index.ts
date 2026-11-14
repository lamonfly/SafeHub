import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { createHttpClient, type HttpClient } from "../http";
import { errorResult, type IntegrationResult } from "../result";
import { createTlsAgent } from "../tls";
import {
  guestSchema,
  responseSchema,
  nodeSchema,
  type GuestActionInput,
  type ProxmoxGuest,
  type ProxmoxNode,
} from "./schemas";

const client =
  env.PROXMOX_URL && env.PROXMOX_TOKEN_ID && env.PROXMOX_TOKEN_SECRET
    ? createHttpClient({
        name: "Proxmox",
        baseUrl: new URL("/api2/json/", env.PROXMOX_URL).href,
        headers: {
          Authorization: `PVEAPIToken=${env.PROXMOX_TOKEN_ID}=${env.PROXMOX_TOKEN_SECRET}`,
        },
        dispatcher: createTlsAgent({
          caCertPath: env.PROXMOX_CA_CERT_PATH,
          allowSelfSigned: env.PROXMOX_ALLOW_SELF_SIGNED,
        }),
      })
    : null;

// The dashboard hides the Proxmox card when this is false.
export const proxmoxConfigured = client !== null;

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

export type ProxmoxOverview = {
  nodes: ProxmoxNode[];
  guests: ProxmoxGuest[];
};

export async function getProxmoxOverview(): Promise<IntegrationResult<ProxmoxOverview>> {
  if (!client) return { status: "not-configured" };
  try {
    const [nodes, guests] = await Promise.all([
      request(client, "get", "nodes", z.array(nodeSchema)),
      request(client, "get", "cluster/resources?type=vm", z.array(guestSchema)),
    ]);
    return {
      status: "ok",
      data: {
        nodes: nodes.sort((a, b) => a.node.localeCompare(b.node)),
        guests: guests.filter((guest) => !guest.template).sort((a, b) => a.vmid - b.vmid),
      },
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
