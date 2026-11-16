import { chmodSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb } from "../../../../tests/support/helpers";

// A fake Docker Engine on a Unix socket (a named pipe on Windows), like the
// socket mounted into SafeHub's container.
const socketPath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\safehub-docker-test-${process.pid}`
    : join(tmpdir(), `safehub-docker-test-${process.pid}.sock`);

const sonarrId = "a".repeat(64);
const requests: string[] = [];
let sonarrState = "running";
// A container in a crash loop: started seconds ago, restarted 4 times.
const loopingId = "e".repeat(64);
let includeLooping = false;
let cpuTotal = 1_000;
// A container whose stats take long on a busy daemon.
const slowId = "1".repeat(64);
let server: http.Server;
let docker: typeof import(".");

beforeAll(async () => {
  server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === "POST") {
      const match = request.url!.match(/^\/containers\/([a-f0-9]+)\/(start|stop|restart)/);
      if (!match || match[1] !== sonarrId) return json(response, { message: "No such container" }, 404, "Not Found");
      const wanted = match[2] === "stop" ? "exited" : "running";
      if (match[2] !== "restart" && sonarrState === wanted) {
        response.writeHead(304);
        return response.end();
      }
      sonarrState = wanted;
      response.writeHead(204);
      return response.end();
    }
    if (request.url === "/info") return json(response, { Name: "docker-vm", ServerVersion: "27.3.1" });
    if (request.url === `/containers/${"d".repeat(64)}/json`) return json(response, { State: { OOMKilled: true } });
    if (request.url === `/containers/${loopingId}/json`) return json(response, { RestartCount: 4, State: { OOMKilled: false } });
    if (request.url === `/containers/${slowId}/stats?stream=false&one-shot=true`) {
      setTimeout(() => json(response, { memory_stats: { usage: 1, limit: 2 } }), 1_500);
      return;
    }
    if (request.url === `/containers/${sonarrId}/stats?stream=false&one-shot=true`) {
      cpuTotal += 500;
      return json(response, {
        cpu_stats: { cpu_usage: { total_usage: cpuTotal }, system_cpu_usage: cpuTotal * 10, online_cpus: 4 },
        precpu_stats: {},
        memory_stats: { usage: 300, limit: 1_000, stats: { inactive_file: 100 } },
      });
    }
    if (request.url === "/networks") {
      return json(response, [
        { Name: "bridge", IPAM: { Config: [{ Subnet: "172.17.0.0/16", Gateway: "172.17.0.1" }] } },
        { Name: "host", IPAM: { Config: null } },
      ]);
    }
    if (request.url === "/containers/json?all=1") {
      return json(response, [
        ...(includeLooping
          ? [{ Id: loopingId, Names: ["/flaky"], Image: "flaky", State: "running", Status: "Up 40 seconds", Ports: [], Labels: null }]
          : []),
        {
          // Exit code 137 like "docker stop", but killed for lack of memory.
          Id: "d".repeat(64),
          Names: ["/immich-ml"],
          Image: "immich-machine-learning",
          State: "exited",
          Status: "Exited (137) 5 minutes ago",
          Ports: [],
          Labels: null,
        },
        {
          Id: "b".repeat(64),
          Names: ["/watchtower"],
          Image: "containrrr/watchtower",
          State: "exited",
          Status: "Exited (0) 2 days ago",
          Ports: [],
          Labels: null,
        },
        {
          Id: sonarrId,
          Names: ["/sonarr"],
          Image: "lscr.io/linuxserver/sonarr",
          State: sonarrState,
          Status: "Up 3 hours (healthy)",
          // IPv4 and IPv6 bindings of one port, plus an unpublished one.
          Ports: [
            { IP: "0.0.0.0", PrivatePort: 8989, PublicPort: 8989, Type: "tcp" },
            { IP: "::", PrivatePort: 8989, PublicPort: 8989, Type: "tcp" },
            { PrivatePort: 9000, Type: "tcp" },
          ],
          Labels: { "com.docker.compose.project": "servarr", "com.docker.compose.service": "sonarr" },
        },
      ]);
    }
    return json(response, { message: "page not found" }, 404, "Not Found");
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  process.env.DOCKER_SOCKET = socketPath;
  await migratedDb();
  docker = await import(".");
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("Docker", () => {
  it("finds the socket and lists containers, running first", async () => {
    expect(docker.isDockerConfigured()).toBe(true);
    expect(await docker.getDockerHost()).toEqual({
      status: "ok",
      data: {
        name: "docker-vm",
        version: "27.3.1",
        gateways: ["172.17.0.1"],
        containers: [
          {
            id: sonarrId,
            name: "sonarr",
            image: "lscr.io/linuxserver/sonarr",
            state: "running",
            status: "Up 3 hours (healthy)",
            ports: [8989],
            project: "servarr",
            composeService: "sonarr",
            self: false,
          },
          {
            id: "d".repeat(64),
            name: "immich-ml",
            image: "immich-machine-learning",
            state: "exited",
            status: "Exited (137) 5 minutes ago",
            exitCode: 137,
            oomKilled: true,
            ports: [],
            project: undefined,
            self: false,
          },
          {
            id: "b".repeat(64),
            name: "watchtower",
            image: "containrrr/watchtower",
            state: "exited",
            status: "Exited (0) 2 days ago",
            exitCode: 0,
            ports: [],
            project: undefined,
            self: false,
          },
        ],
      },
    });
  });

  it("reads the restart count only of containers that just started", async () => {
    includeLooping = true;
    await new Promise((resolve) => setTimeout(resolve, 5_100)); // past the 5 s host cache
    const result = await docker.getDockerHost();
    includeLooping = false;
    expect(result.status).toBe("ok");
    const containers = result.status === "ok" ? result.data.containers : [];
    expect(containers.find((item) => item.name === "flaky")?.restartCount).toBe(4);
    expect(containers.find((item) => item.name === "sonarr")?.restartCount).toBeUndefined();
    expect(requests).not.toContain(`GET /containers/${sonarrId}/json`);
    expect(docker.startedRecently("Up Less than a second")).toBe(true);
    expect(docker.startedRecently("Up About a minute (health: starting)")).toBe(true);
    expect(docker.startedRecently("Up 2 minutes")).toBe(false);
    expect(docker.startedRecently("Up 3 hours (healthy)")).toBe(false);
  });

  it("reads CPU and memory, CPU from the change since the last reading", async () => {
    const first = await docker.getContainerStats([{ id: sonarrId }]);
    // No earlier reading yet: CPU unknown. Memory without the file cache.
    expect(first.get(sonarrId)).toEqual({ cpuPercent: undefined, memoryBytes: 200, memoryPercent: 20 });
    const second = await docker.getContainerStats([{ id: sonarrId }]);
    // +500 of +5,000 system time: 10 % of the whole host.
    expect(second.get(sonarrId)?.cpuPercent).toBeCloseTo(10);
    // Unknown containers are left out, nothing throws.
    expect((await docker.getContainerStats([{ id: "f".repeat(64) }])).size).toBe(0);
  });

  it("returns the stats that arrived in time when the daemon is slow", async () => {
    const started = Date.now();
    const stats = await docker.getContainerStats([{ id: slowId }, { id: sonarrId }], 300);
    expect(Date.now() - started).toBeLessThan(1_200);
    expect(stats.has(sonarrId)).toBe(true);
    expect(stats.has(slowId)).toBe(false);
    // The late answer does not change the map afterwards.
    await new Promise((resolve) => setTimeout(resolve, 1_600));
    expect(stats.has(slowId)).toBe(false);
  });

  it("computes CPU and memory like docker stats", () => {
    expect(docker.cpuPercent({ container: 100, system: 1_000 }, { container: 300, system: 2_000 })).toBeCloseTo(20);
    expect(docker.cpuPercent(undefined, { container: 1, system: 1 })).toBeUndefined();
    // Restarted container: its counter went back.
    expect(docker.cpuPercent({ container: 500, system: 1_000 }, { container: 10, system: 2_000 })).toBeUndefined();
    expect(docker.memoryUse({ memory_stats: { usage: 1_000, limit: 4_000, stats: { total_inactive_file: 200 } } })).toEqual({
      memoryBytes: 800,
      memoryPercent: 20,
    });
    expect(docker.memoryUse({ memory_stats: {} })).toEqual({});
  });

  it("stops, starts and restarts containers; 'already in that state' counts as done", async () => {
    expect(await docker.runContainerAction({ id: sonarrId, action: "stop" })).toEqual({ status: "ok", data: undefined });
    expect(sonarrState).toBe("exited");
    expect(requests).toContain(`POST /containers/${sonarrId}/stop?t=10`);
    expect(await docker.runContainerAction({ id: sonarrId, action: "stop" })).toMatchObject({ status: "ok" });
    expect(await docker.runContainerAction({ id: sonarrId, action: "start" })).toMatchObject({ status: "ok" });
    expect(await docker.runContainerAction({ id: sonarrId, action: "restart" })).toMatchObject({ status: "ok" });
    expect(sonarrState).toBe("running");
  });

  it("reports Docker's error", async () => {
    expect(await docker.runContainerAction({ id: "c".repeat(64), action: "start" })).toMatchObject({
      status: "error",
      message: "Docker 404 Not Found",
    });
  });

  it("treats a socket SafeHub may not use like a missing one", async () => {
    expect(docker.dockerSocketState(join(tmpdir(), "safehub-no-such.sock"))).toBe("missing");
    expect(docker.dockerSocketState(tmpdir())).toBe("missing"); // not a socket
    // Unix permissions: not on Windows, and root may use any socket.
    if (process.platform === "win32" || process.getuid?.() === 0) return;
    const path = join(tmpdir(), `safehub-docker-locked-${process.pid}.sock`);
    const locked = http.createServer();
    await new Promise<void>((resolve) => locked.listen(path, resolve));
    try {
      expect(docker.dockerSocketState(path)).toBe("ok");
      chmodSync(path, 0o000);
      expect(docker.dockerSocketState(path)).toBe("no-access");
    } finally {
      await new Promise((resolve) => locked.close(resolve));
    }
  });

  it("only accepts container IDs and known actions", () => {
    const schema = docker.containerActionInputSchema;
    expect(schema.safeParse({ id: sonarrId, action: "restart" }).success).toBe(true);
    expect(schema.safeParse({ id: "../images/create", action: "start" }).success).toBe(false);
    expect(schema.safeParse({ id: sonarrId, action: "kill" }).success).toBe(false);
  });
});
