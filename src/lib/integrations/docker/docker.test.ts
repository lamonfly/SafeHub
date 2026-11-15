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
    if (request.url === "/networks") {
      return json(response, [
        { Name: "bridge", IPAM: { Config: [{ Subnet: "172.17.0.0/16", Gateway: "172.17.0.1" }] } },
        { Name: "host", IPAM: { Config: null } },
      ]);
    }
    if (request.url === "/containers/json?all=1") {
      return json(response, [
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
          Labels: { "com.docker.compose.project": "servarr" },
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

  it("only accepts container IDs and known actions", () => {
    const schema = docker.containerActionInputSchema;
    expect(schema.safeParse({ id: sonarrId, action: "restart" }).success).toBe(true);
    expect(schema.safeParse({ id: "../images/create", action: "start" }).success).toBe(false);
    expect(schema.safeParse({ id: sonarrId, action: "kill" }).success).toBe(false);
  });
});
