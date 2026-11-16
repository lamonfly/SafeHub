import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { perSettings } from "@/lib/settings/memo";
import { getFlag, getSetting } from "@/lib/settings/store";
import { createHttpClient, type HttpClient } from "../http";
import { errorResult, type IntegrationResult } from "../result";
import { createTlsAgent } from "../tls";
import { forgetOtherGuests, getGuestNetworks, type GuestNetworks } from "./addresses";
import { createBackupReader, fetchBackupInfo, type BackupInfo } from "./backups";
import { cacheFor } from "../cache";
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

function buildClient(timeoutMs?: number): HttpClient | null {
  const url = getSetting("PROXMOX_URL");
  const tokenId = getSetting("PROXMOX_TOKEN_ID");
  const tokenSecret = getSetting("PROXMOX_TOKEN_SECRET");
  if (!url || !tokenId || !tokenSecret) return null;
  return createHttpClient({
    name: "Proxmox",
    baseUrl: new URL("/api2/json/", url).href,
    headers: { Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}` },
    dispatcher: proxmoxTlsAgent(),
    timeoutMs,
  });
}

const getClient = perSettings(() => buildClient());
// Listing a large backup storage (PBS datastore) can take well over 5 s.
const getBackupClient = perSettings(() => buildClient(30_000));

// The dashboard hides the Proxmox card when this is false.
export function isProxmoxConfigured(): boolean {
  return getClient() !== null;
}

// For the setup check (lib/diagnostics), which asks Proxmox directly.
export function getProxmoxClient(): HttpClient | null {
  return getClient();
}

// One backup reader per settings (see createBackupReader for the timing).
const getBackups = perSettings(() =>
  createBackupReader((nodes) => {
    const client = getBackupClient();
    if (!client) return Promise.reject(new Error("Proxmox is not configured"));
    return fetchBackupInfo(client, nodes);
  }),
);

export function backupMaxAgeDays(): number {
  const days = Number(getSetting("PROXMOX_BACKUP_MAX_AGE_DAYS") ?? 7);
  return Number.isFinite(days) && days > 0 ? days : 7;
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

export type GuestWithAddresses = ProxmoxGuest &
  GuestNetworks & {
    // Age of the newest backup: null = never backed up, undefined = unknown
    // (no backup data, e.g. the token cannot read the storages).
    backupAgeMs?: number | null;
    backupOverdue?: boolean;
  };

export type ProxmoxOverview = {
  nodes: ProxmoxNode[];
  guests: GuestWithAddresses[];
  backups: BackupInfo | null;
};

// Always asks Proxmox (the sampler, the setup check, and right after a
// certificate was accepted). The dashboard uses getCachedProxmoxOverview.
export async function getProxmoxOverview(): Promise<IntegrationResult<ProxmoxOverview>> {
  const client = getClient();
  if (!client) return { status: "not-configured" };
  try {
    return { status: "ok", data: await fetchOverview(client) };
  } catch (error) {
    return errorResult(error);
  }
}

// For pages that refresh every 10 s: several open tabs share one round of
// Proxmox calls for 5 s. Failures are not cached, so an error (or an accepted
// certificate) shows on the next refresh. A guest action replaces the cache,
// so the refresh after it shows the new state.
function newOverviewCache() {
  return cacheFor(5_000, () => {
    const client = getClient();
    return client ? fetchOverview(client) : Promise.reject(new Error("Proxmox is not configured"));
  });
}
const overviewCache = perSettings(() => ({ current: newOverviewCache() }));

export async function getCachedProxmoxOverview(): Promise<IntegrationResult<ProxmoxOverview>> {
  if (!getClient()) return { status: "not-configured" };
  try {
    return { status: "ok", data: await overviewCache().current() };
  } catch (error) {
    return errorResult(error);
  }
}

async function fetchOverview(client: HttpClient): Promise<ProxmoxOverview> {
  const [nodes, guests] = await Promise.all([
    request(client, "get", "nodes", z.array(nodeSchema)),
    request(client, "get", "cluster/resources?type=vm", z.array(guestSchema)),
  ]);
  const visible = guests.filter((guest) => !guest.template).sort((a, b) => a.vmid - b.vmid);
  forgetOtherGuests(client, guests);
  const [withAddresses, backups] = await Promise.all([
    Promise.all(visible.map(async (guest) => ({ ...guest, ...(await getGuestNetworks(client, guest)) }))),
    getBackups()(nodes.filter((node) => node.status === "online").map((node) => node.node)),
  ]);
  const now = Date.now();
  const maxAgeMs = backupMaxAgeDays() * 86_400_000;
  const withBackups = withAddresses.map((guest) => {
    if (!backups) return guest;
    const last = backups.lastBackup[guest.vmid];
    const backupAgeMs = last === undefined ? null : now - last;
    // With a storage missing, a newer backup may sit on it: never call a
    // guest overdue on partial data.
    const complete = backups.failedStorages.length === 0;
    return { ...guest, backupAgeMs, backupOverdue: complete && backupAgeMs !== null && backupAgeMs > maxAgeMs };
  });
  return { nodes: nodes.sort((a, b) => a.node.localeCompare(b.node)), guests: withBackups, backups };
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
  } finally {
    overviewCache().current = newOverviewCache();
  }
}
