import "server-only";
import { readFileSync, statSync } from "node:fs";
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
  // Ports published on the Docker host (TCP), lowest first.
  ports: number[];
  // Compose project, when started with docker compose.
  project?: string;
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

function socketExists(): boolean {
  // Windows named pipe (development and tests on Windows): cannot be stat'ed.
  if (env.DOCKER_SOCKET.startsWith("\\\\.\\pipe\\")) return true;
  try {
    return statSync(env.DOCKER_SOCKET).isSocket();
  } catch {
    return false;
  }
}

let client: HttpClient | undefined;
let actionClient: HttpClient | undefined;

function getClients(): { client: HttpClient; actionClient: HttpClient } | null {
  if (!socketExists()) return null;
  if (!client || !actionClient) {
    const dispatcher = new Agent({ connect: { socketPath: env.DOCKER_SOCKET } });
    client = createHttpClient({ name: "Docker", baseUrl: "http://docker/", dispatcher });
    // Stopping waits for the container to exit (up to 10 s, then Docker kills it).
    actionClient = createHttpClient({ name: "Docker", baseUrl: "http://docker/", dispatcher, timeoutMs: 30_000 });
  }
  return { client, actionClient };
}

// The dashboard hides Docker when this is false.
export function isDockerConfigured(): boolean {
  return socketExists();
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
    self: isOwnContainer(raw.Id),
  };
}

const inspectSchema = z.object({ State: z.object({ OOMKilled: z.boolean().default(false) }) });

// Result per container ID while it stays exited with 137: a stopped
// container does not change, so it is inspected once, not every minute.
const oomChecked = new Map<string, boolean>();

async function markOutOfMemory(client: HttpClient, containers: DockerContainer[]): Promise<void> {
  const candidates = containers.filter((container) => container.state === "exited" && container.exitCode === 137);
  const ids = new Set(candidates.map((container) => container.id));
  for (const id of oomChecked.keys()) if (!ids.has(id)) oomChecked.delete(id);
  await Promise.all(
    candidates.map(async (container) => {
      let oom = oomChecked.get(container.id);
      if (oom === undefined) {
        oom = await client
          .get(`containers/${container.id}/json`, inspectSchema)
          .then((details) => details.State.OOMKilled)
          .catch(() => undefined);
        if (oom !== undefined) oomChecked.set(container.id, oom);
      }
      container.oomKilled = oom ?? false;
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
  await markOutOfMemory(client, list);
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
