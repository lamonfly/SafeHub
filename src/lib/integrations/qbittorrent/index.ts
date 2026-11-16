import "server-only";
import { createHash } from "node:crypto";
import type { Agent } from "undici";
import { z } from "zod";
import { formatBytes } from "@/lib/format";
import { perSettings } from "@/lib/settings/memo";
import { getSetting } from "@/lib/settings/store";
import { getForwardedPort, getGluetunClient } from "../gluetun";
import { fetchWithoutLeaks, type HttpClient, type ServiceAction, type ServiceSummary } from "../http";
import { attempt, type IntegrationResult } from "../result";
import { serviceTlsAgent } from "../tls";

// qBittorrent Web API v2. Auth is a session cookie from a form login
// (cookie "SID", or "QBT_SID_<port>" since 5.0). Without a username the
// login is skipped, for setups that bypass auth for SafeHub's subnet.

const TIMEOUT_MS = 5_000;
// qBittorrent bans the client IP after repeated failed logins (default 5,
// for an hour). While banned, wait before trying again.
const BAN_BACKOFF_MS = 5 * 60_000;

type Config = { name: string; baseUrl: string; username?: string; password?: string; dispatcher?: Agent };

// Login blocks by connection (URL + account), kept outside the client: saving
// an unrelated setting rebuilds the client but must not retry a rejected
// password (each retry counts towards qBittorrent's IP ban). until undefined
// means "until the credentials change". Only the connection of the newest
// client is kept, so old URLs and passwords do not pile up.
const loginBlocks = new Map<string, { until?: number; message: string }>();

function connectionId(config: Config): string {
  return createHash("sha256")
    .update(JSON.stringify([config.baseUrl, config.username ?? "", config.password ?? ""]))
    .digest("hex");
}

export function createQbittorrentClient(config: Config): HttpClient {
  const baseUrl = new URL(config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`);
  const connection = connectionId(config);
  for (const id of loginBlocks.keys()) {
    if (id !== connection) loginBlocks.delete(id);
  }
  let cookie: Promise<string> | undefined;

  async function send(method: string, path: string, body?: URLSearchParams, sessionCookie?: string) {
    const { response } = await fetchWithoutLeaks(config.name, new URL(path, baseUrl), {
      method,
      headers: {
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      body,
      dispatcher: config.dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response;
  }

  async function login(): Promise<string> {
    const blocked = loginBlocks.get(connection);
    if (blocked && blocked.until === undefined) throw new Error(blocked.message);
    if (blocked?.until !== undefined && Date.now() < blocked.until) {
      const minutes = Math.ceil((blocked.until - Date.now()) / 60_000);
      throw new Error(`${blocked.message} Next attempt in ${minutes} min.`);
    }
    const response = await send(
      "POST",
      "api/v2/auth/login",
      new URLSearchParams({ username: config.username ?? "", password: config.password ?? "" }),
    );
    const text = await response.text();
    // A real rejection: "Fails." (4.x answers 200, newer versions 401).
    if (text.startsWith("Fails") || response.status === 401) {
      const message = "qBittorrent rejected the username or password. SafeHub stops trying until they are changed.";
      loginBlocks.set(connection, { message });
      throw new Error(message);
    }
    if (response.status === 403) {
      const message = "qBittorrent has banned SafeHub's IP after too many failed logins.";
      loginBlocks.set(connection, { until: Date.now() + BAN_BACKOFF_MS, message });
      throw new Error(message);
    }
    // Anything else (5xx, a proxy error) is an ordinary error: not a wrong
    // password, so the next refresh simply tries again.
    if (!response.ok) throw new Error(`${config.name} ${response.status} ${response.statusText}`.trim());
    loginBlocks.delete(connection);
    // No cookie: qBittorrent skips auth for this client (subnet whitelist).
    return response.headers.getSetCookie().map((value) => value.split(";")[0]).find((pair) => pair.includes("SID")) ?? "";
  }

  // One shared login; a failed one is forgotten so the next call retries.
  function session(): Promise<string> {
    cookie ??= login().catch((error) => {
      cookie = undefined;
      throw error;
    });
    return cookie;
  }

  async function request<T extends z.ZodType>(method: string, path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    const form = body === undefined ? undefined : new URLSearchParams(body as Record<string, string>);
    const needsLogin = Boolean(config.username);
    const used = needsLogin ? session() : undefined;
    let response = await send(method, path, form, await used);
    // 403: session expired (or qBittorrent restarted). Log in once more;
    // parallel requests share that login (only the first drops the session).
    if (response.status === 403 && needsLogin) {
      await response.body?.cancel();
      if (cookie === used) cookie = undefined;
      response = await send(method, path, form, await session());
    }
    if (response.status === 403) {
      await response.body?.cancel();
      throw new Error(
        needsLogin
          ? "qBittorrent refused the session."
          : "qBittorrent needs a login: set its username and password, or allow SafeHub's subnet without authentication.",
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`${config.name} ${response.status} ${response.statusText}`.trim());
    }
    // Some endpoints answer plain text (app/version), the rest JSON.
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) {
      await response.body?.cancel();
      throw new Error("qBittorrent answered with a web page instead of API data. Check the URL: use the Web UI address, e.g. http://gluetun:8080.");
    }
    const text = await response.text();
    const data = contentType.includes("json") ? JSON.parse(text) : text === "" ? undefined : text;
    return schema.parse(data) as z.infer<T>;
  }

  return {
    baseUrl,
    get: (path, schema) => request("GET", path, schema),
    post: (path, schema, body) => request("POST", path, schema, body),
  };
}

export const getQbittorrentClient = perSettings((): HttpClient | null => {
  const url = getSetting("QBITTORRENT_URL");
  return url
    ? createQbittorrentClient({
        name: "qBittorrent",
        baseUrl: url,
        username: getSetting("QBITTORRENT_USERNAME"),
        password: getSetting("QBITTORRENT_PASSWORD"),
        dispatcher: serviceTlsAgent("qbittorrent"),
      })
    : null;
});

const transferSchema = z.object({
  dl_info_speed: z.number(),
  up_info_speed: z.number(),
  connection_status: z.string(),
});
const torrentsSchema = z.array(z.object({ state: z.string() }));
const preferencesSchema = z.object({ listen_port: z.number() });
const portSchema = z.number().int().min(1).max(65535);

const DOWNLOADING = new Set(["downloading", "forcedDL", "metaDL", "forcedMetaDL"]);
const STALLED = new Set(["stalledDL"]);
const BROKEN = new Set(["error", "missingFiles"]);

export const formatSpeed = (bytesPerSecond: number) => `${formatBytes(bytesPerSecond)}/s`;

// Gluetun's forwarded port next to qBittorrent's listening port. null when
// Gluetun forwards no port. Throws when either cannot be read.
async function readPorts(client: HttpClient, gluetun: HttpClient) {
  const [forwardedPort, preferences] = await Promise.all([
    getForwardedPort(gluetun),
    client.get("api/v2/app/preferences", preferencesSchema),
  ]);
  return forwardedPort === null ? null : { forwardedPort, listenPort: preferences.listen_port };
}

export type PortForwardMismatch = { forwardedPort: number; listenPort: number };

// For alerts: ok with null when the ports match or Gluetun forwards no port,
// ok with both ports when qBittorrent listens on another port than the one
// the VPN forwards. not-configured unless both qBittorrent and Gluetun are.
export async function getPortForwardMismatch(): Promise<IntegrationResult<PortForwardMismatch | null>> {
  const client = getQbittorrentClient();
  const gluetun = getGluetunClient();
  if (!client || !gluetun) return { status: "not-configured" };
  return attempt(async () => {
    const ports = await readPorts(client, gluetun);
    return ports && ports.forwardedPort !== ports.listenPort ? ports : null;
  });
}

// Only torrents that can be downloading or broken are fetched (the
// "downloading" filter also covers stalled, queued and paused downloads), not
// the whole seeding library.
export async function qbittorrentSummary(client: HttpClient): Promise<ServiceSummary> {
  const gluetun = getGluetunClient();
  const [version, transfer, downloading, errored, ports] = await Promise.all([
    client.get("api/v2/app/version", z.string()),
    client.get("api/v2/transfer/info", transferSchema),
    client.get("api/v2/torrents/info?filter=downloading", torrentsSchema),
    client.get("api/v2/torrents/info?filter=errored", torrentsSchema),
    // The port check is extra: a failure leaves it out, not the tile.
    gluetun ? readPorts(client, gluetun).catch(() => null) : null,
  ]);
  // States are checked again, in case a version ignores a filter.
  const count = (states: Set<string>, torrents = downloading) =>
    torrents.filter((torrent) => states.has(torrent.state)).length;
  const broken = count(BROKEN, errored);
  const issues: string[] = [];
  if (transfer.connection_status === "disconnected") issues.push("No network connection.");
  if (transfer.connection_status === "firewalled") issues.push("Listening port not reachable (firewalled).");
  if (ports && ports.forwardedPort !== ports.listenPort) {
    issues.push(`Listening on port ${ports.listenPort}, but the VPN forwards port ${ports.forwardedPort}.`);
  }
  if (broken > 0) issues.push(`${broken} torrent${broken === 1 ? "" : "s"} with errors.`);
  return {
    version: version.replace(/^v/, ""),
    stats: [
      { label: "Download", value: formatSpeed(transfer.dl_info_speed) },
      { label: "Upload", value: formatSpeed(transfer.up_info_speed) },
      { label: "Downloading", value: count(DOWNLOADING) },
      { label: "Stalled", value: count(STALLED) },
    ],
    issues,
  };
}

// qBittorrent 5 renamed pause/resume to stop/start; fall back for 4.x.
async function stopOrStart(client: HttpClient, current: "stop" | "start", legacy: "pause" | "resume") {
  try {
    await client.post(`api/v2/torrents/${current}`, z.unknown(), { hashes: "all" });
  } catch (error) {
    if (!(error instanceof Error && / 404\b/.test(error.message))) throw error;
    await client.post(`api/v2/torrents/${legacy}`, z.unknown(), { hashes: "all" });
  }
}

// Sets qBittorrent's listening port to the port Gluetun forwards (it changes
// on reconnects with some providers).
async function useVpnPort(client: HttpClient): Promise<string> {
  const gluetun = getGluetunClient();
  if (!gluetun) throw new Error("Gluetun is not configured.");
  const ports = await readPorts(client, gluetun);
  if (!ports) throw new Error("Gluetun does not forward a port.");
  const port = portSchema.parse(ports.forwardedPort);
  if (port === ports.listenPort) return `Already listening on port ${port}.`;
  await client.post("api/v2/app/setPreferences", z.unknown(), { json: JSON.stringify({ listen_port: port }) });
  return `Listening port set to ${port}.`;
}

export const qbittorrentActions: ServiceAction[] = [
  {
    id: "pause-all",
    label: "Pause all",
    confirm: "Pause all torrents? Downloads and seeding stop until you resume them.",
    run: async (client) => {
      await stopOrStart(client, "stop", "pause");
      return "All torrents paused.";
    },
  },
  {
    id: "resume-all",
    label: "Resume all",
    run: async (client) => {
      await stopOrStart(client, "start", "resume");
      return "All torrents resumed.";
    },
  },
  {
    id: "use-vpn-port",
    label: "Use VPN port",
    confirm: "Set qBittorrent's listening port to the port Gluetun forwards? Open connections to peers may drop briefly.",
    available: () => getGluetunClient() !== null,
    run: useVpnPort,
  },
];
