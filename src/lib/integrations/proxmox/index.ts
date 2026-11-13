import "server-only";
import { fetch } from "undici";
import { z } from "zod";
import { env } from "@/lib/env";
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

const TIMEOUT_MS = 5_000;

const config =
  env.PROXMOX_URL && env.PROXMOX_TOKEN_ID && env.PROXMOX_TOKEN_SECRET
    ? {
        baseUrl: new URL("/api2/json/", env.PROXMOX_URL),
        authorization: `PVEAPIToken=${env.PROXMOX_TOKEN_ID}=${env.PROXMOX_TOKEN_SECRET}`,
        dispatcher: createTlsAgent({
          caCertPath: env.PROXMOX_CA_CERT_PATH,
          allowSelfSigned: env.PROXMOX_ALLOW_SELF_SIGNED,
        }),
      }
    : null;

type Config = NonNullable<typeof config>;

async function request<T extends z.ZodType>(
  config: Config,
  method: "GET" | "POST",
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetch(new URL(path, config.baseUrl), {
    method,
    headers: { Authorization: config.authorization },
    dispatcher: config.dispatcher,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    // Proxmox puts the reason in the status text, e.g. "Permission check failed".
    throw new Error(`Proxmox ${response.status} ${response.statusText}`.trim());
  }
  return schema.parse(responseSchema.parse(await response.json()).data);
}

export type ProxmoxOverview = {
  nodes: ProxmoxNode[];
  guests: ProxmoxGuest[];
};

export async function getProxmoxOverview(): Promise<IntegrationResult<ProxmoxOverview>> {
  if (!config) return { status: "not-configured" };
  try {
    const [nodes, guests] = await Promise.all([
      request(config, "GET", "nodes", z.array(nodeSchema)),
      request(config, "GET", "cluster/resources?type=vm", z.array(guestSchema)),
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
  if (!config) return { status: "not-configured" };
  try {
    const upid = await request(
      config,
      "POST",
      `nodes/${node}/${type}/${vmid}/status/${action}`,
      z.string(),
    );
    return { status: "ok", data: upid };
  } catch (error) {
    return errorResult(error);
  }
}
