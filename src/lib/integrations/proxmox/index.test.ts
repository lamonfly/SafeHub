import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../../tests/support/helpers";

// Fake Proxmox with one container that a guest action starts.
let status = "stopped";
let overviewReads = 0;
let server: Awaited<ReturnType<typeof startHttp>>;
let proxmox: typeof import(".");

beforeAll(async () => {
  server = await startHttp((request, _body, response) => {
    const path = request.url!.replace("/api2/json/", "");
    if (path === "nodes") {
      overviewReads++;
      return json(response, { data: [{ node: "pve", status: "online" }] });
    }
    if (path === "cluster/resources?type=vm") return json(response, { data: [{ type: "lxc", vmid: 100, node: "pve", status }] });
    if (path === "nodes/pve/lxc/100/status/start" && request.method === "POST") {
      status = "running";
      return json(response, { data: "UPID:pve:start" });
    }
    // Addresses and backups: nothing to report.
    return json(response, { data: [] });
  });
  await migratedDb();
  const store = await import("@/lib/settings/store");
  store.saveSettings({ PROXMOX_URL: server.url, PROXMOX_TOKEN_ID: "safehub@pve!safehub", PROXMOX_TOKEN_SECRET: "secret" });
  proxmox = await import(".");
});
afterAll(() => server.close());

const guestStatus = async () => {
  const result = await proxmox.getCachedProxmoxOverview();
  return result.status === "ok" ? result.data.guests[0].status : result.status;
};

describe("cached Proxmox overview", () => {
  it("is shared for a few seconds, but a guest action drops it", async () => {
    expect(await guestStatus()).toBe("stopped");
    expect(await guestStatus()).toBe("stopped");
    expect(overviewReads).toBe(1);

    expect(await proxmox.runGuestAction({ node: "pve", type: "lxc", vmid: 100, action: "start" })).toEqual({
      status: "ok",
      data: "UPID:pve:start",
    });
    expect(await guestStatus()).toBe("running");
    expect(overviewReads).toBe(2);
  });
});
