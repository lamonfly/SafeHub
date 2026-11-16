import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { json, migratedDb, startHttp } from "../../../../tests/support/helpers";

let logins = 0;
let validSession = "QBT_SID_8080=abc";
let listenPort = 6881;
let forwardedPort = 51234;
const posted: string[] = [];
const torrentQueries: string[] = [];
let server: Awaited<ReturnType<typeof startHttp>>;
let qbittorrent: typeof import(".");

beforeAll(async () => {
  server = await startHttp((request, body, response) => {
    const url = request.url!;
    // Gluetun's control server, on the same fake for simplicity.
    if (url === "/v1/portforward") return json(response, { port: forwardedPort });
    if (url === "/api/v2/auth/login") {
      logins++;
      const form = new URLSearchParams(body);
      if (form.get("username") === "broken") {
        response.writeHead(502, "Bad Gateway");
        return response.end();
      }
      if (form.get("username") !== "admin" || form.get("password") !== "secret") {
        response.writeHead(200, { "Content-Type": "text/plain" });
        return response.end("Fails.");
      }
      response.writeHead(200, { "Content-Type": "text/plain", "Set-Cookie": `${validSession}; HttpOnly; path=/` });
      return response.end("Ok.");
    }
    if (request.headers.cookie !== validSession) {
      response.writeHead(403);
      return response.end("Forbidden");
    }
    if (url === "/api/v2/app/version") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      return response.end("v5.0.2");
    }
    if (url === "/api/v2/transfer/info") {
      return json(response, { dl_info_speed: 2_621_440, up_info_speed: 512, connection_status: "firewalled" });
    }
    if (url === "/api/v2/app/preferences") return json(response, { listen_port: listenPort, other: true });
    if (url === "/api/v2/app/setPreferences" && request.method === "POST") {
      posted.push(`setPreferences ${body}`);
      listenPort = JSON.parse(new URLSearchParams(body).get("json")!).listen_port;
      response.writeHead(200);
      return response.end();
    }
    if (url.startsWith("/api/v2/torrents/info")) {
      torrentQueries.push(url);
      if (url.endsWith("filter=downloading")) return json(response, [{ state: "downloading" }, { state: "stalledDL" }, { state: "pausedDL" }]);
      if (url.endsWith("filter=errored")) return json(response, [{ state: "missingFiles" }]);
      return json(response, []);
    }
    if (url === "/api/v2/torrents/stop") {
      response.writeHead(404);
      return response.end();
    }
    if (url === "/api/v2/torrents/pause" && request.method === "POST") {
      posted.push(`pause ${body}`);
      response.writeHead(200);
      return response.end();
    }
    return json(response, { message: "not found" }, 404, "Not Found");
  });
  process.env.QBITTORRENT_URL = server.url;
  process.env.QBITTORRENT_USERNAME = "admin";
  process.env.QBITTORRENT_PASSWORD = "secret";
  process.env.GLUETUN_URL = server.url;
  await migratedDb();
  qbittorrent = await import(".");
});
afterAll(() => server.close());

const version = (client: ReturnType<typeof qbittorrent.createQbittorrentClient>) => client.get("api/v2/app/version", z.string());

describe("qBittorrent", () => {
  it("logs in with a cookie and summarizes speeds, torrents and issues", async () => {
    const client = qbittorrent.getQbittorrentClient()!;
    expect(await qbittorrent.qbittorrentSummary(client)).toEqual({
      version: "5.0.2",
      stats: [
        { label: "Download", value: "2.5 MiB/s" },
        { label: "Upload", value: "512 B/s" },
        { label: "Downloading", value: 1 },
        { label: "Stalled", value: 1 },
      ],
      issues: [
        "Listening port not reachable (firewalled).",
        "Listening on port 6881, but the VPN forwards port 51234.",
        "1 torrent with errors.",
      ],
    });
    expect(logins).toBe(1);
    // Only the filtered lists, never the whole library.
    expect([...torrentQueries].sort()).toEqual([
      "/api/v2/torrents/info?filter=downloading",
      "/api/v2/torrents/info?filter=errored",
    ]);
  });

  it("logs in again when the session expires", async () => {
    validSession = "QBT_SID_8080=def";
    const client = qbittorrent.getQbittorrentClient()!;
    await qbittorrent.qbittorrentSummary(client);
    expect(logins).toBe(2);
  });

  it("falls back to pause on qBittorrent 4", async () => {
    const pauseAll = qbittorrent.qbittorrentActions.find((action) => action.id === "pause-all")!;
    expect(await pauseAll.run(qbittorrent.getQbittorrentClient()!)).toBe("All torrents paused.");
    expect(posted).toEqual(["pause hashes=all"]);
  });

  it("reports a port mismatch with Gluetun and fixes it with Use VPN port", async () => {
    expect(await qbittorrent.getPortForwardMismatch()).toEqual({ status: "ok", data: { forwardedPort: 51234, listenPort: 6881 } });
    const useVpnPort = qbittorrent.qbittorrentActions.find((action) => action.id === "use-vpn-port")!;
    expect(useVpnPort.confirm).toBeTruthy();
    expect(useVpnPort.available?.()).toBe(true);
    expect(await useVpnPort.run(qbittorrent.getQbittorrentClient()!)).toBe("Listening port set to 51234.");
    expect(posted).toContain(`setPreferences ${new URLSearchParams({ json: '{"listen_port":51234}' })}`);
    expect(await qbittorrent.getPortForwardMismatch()).toEqual({ status: "ok", data: null });
    expect(await useVpnPort.run(qbittorrent.getQbittorrentClient()!)).toBe("Already listening on port 51234.");
  });

  it("treats no forwarded port (0) as nothing to compare", async () => {
    forwardedPort = 0;
    expect(await qbittorrent.getPortForwardMismatch()).toEqual({ status: "ok", data: null });
    const useVpnPort = qbittorrent.qbittorrentActions.find((action) => action.id === "use-vpn-port")!;
    await expect(useVpnPort.run(qbittorrent.getQbittorrentClient()!)).rejects.toThrow("does not forward a port");
    forwardedPort = 51234;
  });

  it("stops logging in after a rejected password until the credentials change", async () => {
    const config = { name: "qBittorrent", baseUrl: server.url, username: "admin", password: "wrong" };
    const before = logins;
    await expect(version(qbittorrent.createQbittorrentClient(config))).rejects.toThrow("rejected the username or password");
    await expect(version(qbittorrent.createQbittorrentClient(config))).rejects.toThrow("rejected the username or password");
    // A rebuilt client (an unrelated setting was saved) keeps the block.
    expect(logins).toBe(before + 1);
    // New credentials are tried.
    expect(await version(qbittorrent.createQbittorrentClient({ ...config, password: "secret" }))).toBe("v5.0.2");
    expect(logins).toBe(before + 2);
    // Only the current connection's block is kept: the old one is gone, so
    // switching back tries once more.
    await expect(version(qbittorrent.createQbittorrentClient(config))).rejects.toThrow("rejected the username or password");
    expect(logins).toBe(before + 3);
  });

  it("treats a server error on login as an ordinary error, not a wrong password", async () => {
    const client = qbittorrent.createQbittorrentClient({ name: "qBittorrent", baseUrl: server.url, username: "broken", password: "x" });
    const before = logins;
    await expect(version(client)).rejects.toThrow("qBittorrent 502 Bad Gateway");
    await expect(version(client)).rejects.toThrow("qBittorrent 502 Bad Gateway");
    expect(logins).toBe(before + 2);
  });
});
