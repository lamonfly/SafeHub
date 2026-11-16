import "server-only";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { Agent } from "undici";
import { z } from "zod";
import { env } from "@/lib/env";
import { cacheFor } from "../cache";
import { createHttpClient, type HttpClient } from "../http";
import { attempt, type IntegrationResult } from "../result";

// Docker Engine API of the machine SafeHub runs on, through the Docker
// socket mounted into the container:
//   volumes:
//     - /var/run/docker.sock:/var/run/docker.sock:ro
// Nothing to configure: without the socket the feature stays hidden.
// DOCKER_SOCKET only changes the path (rootless Docker, tests).

const infoSchema = z.object({
  Name: z.string(),
  ServerVersion: z.string().optional(),
});

const containersSchema = z.array(
  z.object({
    Id: z.string(),
    Names: z.array(z.string()).default([]),
    Image: z.string(),
    State: z.string(),
    Status: z.string().default(""),
    Ports: z
      .array(
        z.object({
          IP: z.string().optional(),
          PrivatePort: z.number(),
          PublicPort: z.number().optional(),
          Type: z.string(),
        }),
      )
      .default([]),
    Labels: z.record(z.string(), z.string()).nullish(),
  }),
);

const networksSchema = z.array(
  z.object({
    Name: z.string(),
    IPAM: z
      .object({
        Config: z.array(z.object({ Subnet: z.string().optional(), Gateway: z.string().optional() })).nullish(),
      })
      .nullish(),
  }),
);

export type DockerContainer = {
  // Full container ID (64 hex characters).
  id: string;
  name: string;
  image: string;
  // created | running | paused | restarting | removing | exited | dead
  state: string;
  // Human text from Docker, e.g. "Up 3 hours (healthy)".
  status: string;
  // Exit code of a stopped container ("Exited (137) 2 hours ago").
  exitCode?: number;
  // Killed for running out of memory. Exit code 137 alone cannot tell this
  // from "docker stop", so such containers are inspected.
  oomKilled?: boolean;
  // Restarts by Docker's restart policy since the container was created
  // (manual restarts do not count). Only read for containers started in the
  // last 2 minutes or restarting; see inspectContainers.
  restartCount?: number;
  // Ports published on the Docker host (TCP), lowest first.
  ports: number[];
  // Compose project and service, when started with docker compose. Other
  // containers in the project reach it by the service name.
  project?: string;
  composeService?: string;
  // SafeHub's own container: it offers no controls (stopping it would take
  // the dashboard down with no way to start it again from here).
  self: boolean;
};

export type DockerHost = {
  // Host name of the machine running Docker (often the Proxmox guest's name).
  name: string;
  version?: string;
  // Gateway addresses of its Docker networks (e.g. 172.17.0.1).
  gateways: string[];
  containers: DockerContainer[];
};

// "no-access": the socket is mounted, but SafeHub's user may not read and
// write it (its group is root's, see docker-entrypoint.sh). Treated like a
// missing socket, so the dashboard and alerts stay quiet; Check setup says why.
export type DockerSocketState = "missing" | "no-access" | "ok";

export function dockerSocketState(path: string = env.DOCKER_SOCKET): DockerSocketState {
  // Windows named pipe (development and tests on Windows): cannot be stat'ed.
  if (path.startsWith("\\\\.\\pipe\\")) return "ok";
  try {
    if (!statSync(path).isSocket()) return "missing";
  } catch {
    return "missing";
  }
  try {
    accessSync(path, constants.R_OK | constants.W_OK);
    return "ok";
  } catch {
    return "no-access";
  }
}

let client: HttpClient | undefined;
let actionClient: HttpClient | undefined;

function getClients(): { client: HttpClient; actionClient: HttpClient } | null {
  if (dockerSocketState() !== "ok") return null;
  if (!client || !actionClient) {
    const dispatcher = new Agent({ connect: { socketPath: env.DOCKER_SOCKET } });
    client = createHttpClient({ name: "Docker", baseUrl: "http://docker/", dispatcher });
    // Stopping waits for the container to exit (up to 10 s, then Docker kills it).
    actionClient = createHttpClient({ name: "Docker", baseUrl: "http://docker/", dispatcher, timeoutMs: 30_000 });
  }
  return { client, actionClient };
}

// The dashboard hides Docker when this is false: no socket, or one SafeHub
// may not use.
export function isDockerConfigured(): boolean {
  return dockerSocketState() === "ok";
}

const stateOrder: Record<string, number> = { running: 0, restarting: 1, paused: 2 };

// SafeHub's own container ID: Docker mounts /etc/hostname etc. from
// /var/lib/docker/containers/<id>/, visible in mountinfo. Fallback: the
// host name, which Docker sets to the short ID unless compose sets another.
function findOwnContainerId(): string {
  try {
    const match = readFileSync("/proc/self/mountinfo", "utf8").match(/\/containers\/([a-f0-9]{64})\//);
    if (match) return match[1];
  } catch {
    // Not Linux, or not in a container.
  }
  return hostname();
}
const ownContainerId = findOwnContainerId();
const isOwnContainer = (id: string) => /^[a-f0-9]{12,64}$/.test(ownContainerId) && id.startsWith(ownContainerId.slice(0, 12));

function exitCodeOf(status: string): number | undefined {
  const match = status.match(/^Exited \((-?\d+)\)/);
  return match ? Number(match[1]) : undefined;
}

export function toContainer(raw: z.infer<typeof containersSchema>[number]): DockerContainer {
  const ports = new Set<number>();
  for (const port of raw.Ports) {
    if (port.PublicPort && port.Type === "tcp") ports.add(port.PublicPort);
  }
  const name = (raw.Names[0] ?? raw.Id.slice(0, 12)).replace(/^\//, "");
  return {
    id: raw.Id,
    name,
    image: raw.Image,
    state: raw.State,
    status: raw.Status,
    exitCode: raw.State === "exited" ? exitCodeOf(raw.Status) : undefined,
    ports: [...ports].sort((a, b) => a - b),
    project: raw.Labels?.["com.docker.compose.project"],
    composeService: raw.Labels?.["com.docker.compose.service"],
    self: isOwnContainer(raw.Id),
  };
}

const inspectSchema = z.object({
  RestartCount: z.number().default(0),
  State: z.object({ OOMKilled: z.boolean().default(false) }),
});

// Result per container ID while it stays exited with 137: a stopped
// container does not change, so it is inspected once, not every minute.
const oomChecked = new Map<string, boolean>();

// Started less than 2 minutes ago: Docker writes "Up 45 seconds", "Up About
// a minute", then "Up 2 minutes".
export function startedRecently(status: string): boolean {
  return /^Up (Less than a second|\d+ seconds?|About a minute)\b/.test(status);
}

// Minutes a running container has been up, at least, from Docker's status
// text ("Up 20 minutes", "Up About an hour", "Up 3 days (healthy)").
// undefined when the text is not an "Up" status.
const MINUTES_PER: Record<string, number> = { second: 1 / 60, minute: 1, hour: 60, day: 1_440, week: 10_080, month: 43_200, year: 525_600 };
export function minutesUp(status: string): number | undefined {
  if (/^Up Less than a second\b/.test(status)) return 0;
  const match = status.match(/^Up (\d+|About an?) (second|minute|hour|day|week|month|year)s?\b/);
  if (!match) return undefined;
  return (match[1].startsWith("About") ? 1 : Number(match[1])) * MINUTES_PER[match[2]];
}

// Restart count per container ID, briefly cached: the dashboard refreshes
// every 10 s, the sampler only needs one fresh value per minute.
const RESTART_CACHE_MS = 20_000;
const restartChecked = new Map<string, { count: number; at: number }>();

// Inspects only the containers that need it, so a host with many containers
// costs no extra requests in a quiet minute:
// - exited with 137: killed for lack of memory, or just stopped? (once)
// - just started, or restarting: how often did the restart policy restart it?
//   Crash loops show up here even when the container is "running" in every
//   sample; a container started minutes ago cannot have restarted since.
async function inspectContainers(client: HttpClient, containers: DockerContainer[]): Promise<void> {
  const now = Date.now();
  const listed = new Set(containers.map((container) => container.id));
  for (const id of oomChecked.keys()) if (!listed.has(id)) oomChecked.delete(id);
  for (const [id, entry] of restartChecked) if (!listed.has(id) || now - entry.at > 10 * 60_000) restartChecked.delete(id);

  const inspect = (id: string) => client.get(`containers/${id}/json`, inspectSchema).catch(() => undefined);
  await Promise.all(
    containers.map(async (container) => {
      if (container.state === "exited" && container.exitCode === 137) {
        let oom = oomChecked.get(container.id);
        if (oom === undefined) {
          oom = (await inspect(container.id))?.State.OOMKilled;
          if (oom !== undefined) oomChecked.set(container.id, oom);
        }
        container.oomKilled = oom ?? false;
        return;
      }
      const fresh = container.state === "restarting" || (container.state === "running" && startedRecently(container.status));
      if (!fresh) return;
      const cached = restartChecked.get(container.id);
      if (cached && now - cached.at < RESTART_CACHE_MS) {
        container.restartCount = cached.count;
        return;
      }
      const details = await inspect(container.id);
      if (!details) return;
      restartChecked.set(container.id, { count: details.RestartCount, at: now });
      container.restartCount = details.RestartCount;
    }),
  );
}

async function fetchHost(client: HttpClient): Promise<DockerHost> {
  const [info, containers, networks] = await Promise.all([
    client.get("info", infoSchema),
    client.get("containers/json?all=1", containersSchema),
    client.get("networks", networksSchema),
  ]);
  const gateways = networks.flatMap((network) =>
    (network.IPAM?.Config ?? []).flatMap((config) => (config.Gateway ? [config.Gateway] : [])),
  );
  const list = containers.map(toContainer);
  await inspectContainers(client, list);
  return {
    name: info.Name,
    version: info.ServerVersion,
    gateways: [...new Set(gateways)],
    containers: list
      .sort(
        (a, b) =>
          (stateOrder[a.state] ?? 3) - (stateOrder[b.state] ?? 3) || a.name.localeCompare(b.name),
      ),
  };
}

// Cached 5 s so several open tabs share one round of requests.
const cachedHost = cacheFor(5_000, async (): Promise<IntegrationResult<DockerHost>> => {
  const clients = getClients();
  if (!clients) return { status: "not-configured" };
  return attempt(() => fetchHost(clients.client));
});

export function getDockerHost(): Promise<IntegrationResult<DockerHost>> {
  return cachedHost();
}

export const containerActions = ["start", "stop", "restart"] as const;
export type ContainerAction = (typeof containerActions)[number];

// Input for control actions; the ID ends up in the request URL.
export const containerActionInputSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{12,64}$/),
  action: z.enum(containerActions),
});
export type ContainerActionInput = z.infer<typeof containerActionInputSchema>;

// Starts, stops (10 s grace, then killed) or restarts a container. Refuses
// SafeHub's own container. Docker answers 204, or 304 when the container
// already is in that state; both count as done.
export async function runContainerAction({ id, action }: ContainerActionInput): Promise<IntegrationResult<void>> {
  const clients = getClients();
  if (!clients) return { status: "not-configured" };
  if (isOwnContainer(id)) return { status: "error", message: "SafeHub cannot control its own container." };
  return attempt(async () => {
    const query = action === "start" ? "" : "?t=10";
    await clients.actionClient.post(`containers/${id}/${action}${query}`, z.unknown());
  });
}

// Resource use per container, for the history charts. Read by the sampler
// once a minute for running containers only (never by the dashboard).

const statsSchema = z.object({
  cpu_stats: z
    .object({
      cpu_usage: z.object({ total_usage: z.number() }).optional(),
      system_cpu_usage: z.number().optional(),
    })
    .optional(),
  memory_stats: z
    .object({
      usage: z.number().optional(),
      limit: z.number().optional(),
      stats: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
});
type RawStats = z.infer<typeof statsSchema>;

export type CpuCounters = { container: number; system: number };

export type ContainerStats = {
  // Share of the whole host's CPU time (all cores together = 100 %). Unknown
  // on the first reading of a container: it needs the previous one.
  cpuPercent?: number;
  // Memory in use without the reclaimable page cache, as "docker stats"
  // shows it, and as a share of the container's limit (the host's memory
  // when it has none).
  memoryBytes?: number;
  memoryPercent?: number;
};

export function cpuCounters(stats: RawStats): CpuCounters | undefined {
  const container = stats.cpu_stats?.cpu_usage?.total_usage;
  const system = stats.cpu_stats?.system_cpu_usage;
  return container !== undefined && system !== undefined ? { container, system } : undefined;
}

// CPU share between two readings. one-shot stats leave precpu_stats empty,
// so the previous reading is the one from the last sampler round.
export function cpuPercent(previous: CpuCounters | undefined, current: CpuCounters | undefined): number | undefined {
  if (!previous || !current) return undefined;
  const containerDelta = current.container - previous.container;
  const systemDelta = current.system - previous.system;
  // A restarted container starts its counter at 0 again.
  if (systemDelta <= 0 || containerDelta < 0) return undefined;
  return Math.min(100, (containerDelta / systemDelta) * 100);
}

// usage includes the page cache, which the kernel drops when memory gets
// short. Like the Docker CLI, subtract the inactive file cache: cgroup v2
// calls it inactive_file, v1 total_inactive_file.
export function memoryUse(stats: RawStats): Pick<ContainerStats, "memoryBytes" | "memoryPercent"> {
  const memory = stats.memory_stats;
  if (memory?.usage === undefined) return {};
  const cache = memory.stats?.inactive_file ?? memory.stats?.total_inactive_file ?? 0;
  const used = Math.max(0, memory.usage - cache);
  return {
    memoryBytes: used,
    memoryPercent: memory.limit ? Math.min(100, (used / memory.limit) * 100) : undefined,
  };
}

const STATS_CONCURRENCY = 4;
const previousCpu = new Map<string, CpuCounters>();

// All stats of one round must arrive within this time; on a slow daemon with
// many containers, the rest get no sample this round instead of holding up
// the sampler (which gives up a whole round after 50 s).
export const STATS_DEADLINE_MS = 15_000;

// Stats for the given containers (by ID), at most 4 requests at a time, each
// with the client's 5 s timeout, all within deadlineMs. A container that
// does not answer in time is left out. Never throws.
export async function getContainerStats(
  containers: Pick<DockerContainer, "id">[],
  deadlineMs = STATS_DEADLINE_MS,
): Promise<Map<string, ContainerStats>> {
  const result = new Map<string, ContainerStats>();
  const clients = getClients();
  if (!clients) return result;
  const ids = containers.map((container) => container.id).filter((id) => /^[a-f0-9]{12,64}$/.test(id));
  for (const id of previousCpu.keys()) if (!ids.includes(id)) previousCpu.delete(id);

  let next = 0;
  let expired = false;
  async function worker() {
    while (!expired && next < ids.length) {
      const id = ids[next++];
      const stats = await clients!.client.get(`containers/${id}/stats?stream=false&one-shot=true`, statsSchema).catch(() => undefined);
      // Arrived after the deadline: the round already moved on without it.
      if (expired) return;
      if (!stats) continue;
      const counters = cpuCounters(stats);
      const cpu = cpuPercent(previousCpu.get(id), counters);
      if (counters) previousCpu.set(id, counters);
      result.set(id, { cpuPercent: cpu, ...memoryUse(stats) });
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, deadlineMs);
    timer.unref?.();
  });
  await Promise.race([Promise.all(Array.from({ length: Math.min(STATS_CONCURRENCY, ids.length) }, worker)), deadline]);
  clearTimeout(timer);
  expired = true;
  return result;
}
