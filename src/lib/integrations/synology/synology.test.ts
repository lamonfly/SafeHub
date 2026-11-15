import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp } from "../../../../tests/support/helpers";

// A DSM 6 style NAS: login lives in auth.cgi, the rest in entry.cgi, and the
// paths are only known through SYNO.API.Info.
const apiInfo = {
  "SYNO.API.Auth": { path: "auth.cgi", minVersion: 1, maxVersion: 6 },
  "SYNO.Core.System": { path: "entry.cgi", minVersion: 1, maxVersion: 3 },
  "SYNO.Core.System.Utilization": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
  "SYNO.Storage.CGI.Storage": { path: "entry.cgi", minVersion: 1, maxVersion: 1 },
};
const requests: string[] = [];
let logins = 0;
let password = "right";

let server: Awaited<ReturnType<typeof startHttp>>;
let synology: typeof import(".");
let store: typeof import("@/lib/settings/store");

beforeAll(async () => {
  server = await startHttp((request, body, response) => {
    const form = new URLSearchParams(body);
    const path = new URL(request.url!, "http://x").pathname;
    const api = form.get("api")!;
    requests.push(`${path} ${api}`);
    if (request.url!.includes("?")) return json(response, { error: "parameters must not be in the URL" }, 400);
    if (path === "/webapi/query.cgi") return json(response, { success: true, data: apiInfo });
    const entry = apiInfo[api as keyof typeof apiInfo];
    if (!entry || `/webapi/${entry.path}` !== path) return json(response, { success: false, error: { code: 102 } });
    if (api === "SYNO.API.Auth") {
      logins++;
      return form.get("passwd") === "right"
        ? json(response, { success: true, data: { sid: "sid1" } })
        : json(response, { success: false, error: { code: 400 } });
    }
    if (api === "SYNO.Core.System.Utilization") {
      return json(response, { success: true, data: { cpu: { user_load: 5, system_load: 2, other_load: 0 }, memory: { real_usage: 40, total_real: 4_000_000 } } });
    }
    if (api === "SYNO.Core.System") return json(response, { success: true, data: { model: "DS218+", firmware_ver: "DSM 6.2.4", up_time: "10:00:00" } });
    return json(response, {
      success: true,
      data: { volumes: [{ id: "volume_1", vol_path: "/volume1", status: "normal", size: { total: "100", used: "50" } }], disks: [] },
    });
  });
  await migratedDb();
  store = await import("@/lib/settings/store");
  store.saveSettings({ SYNOLOGY_URL: server.url, SYNOLOGY_USERNAME: "safehub", SYNOLOGY_PASSWORD: password });
  synology = await import(".");
});
afterAll(() => server.close());

describe("Synology", () => {
  it("finds the DSM 6 API paths and posts everything in the body", async () => {
    const result = await synology.getSynologyOverview();
    expect(result).toMatchObject({ status: "ok", data: { model: "DS218+", cpuPercent: 7 } });
    expect(requests).toContain("/webapi/auth.cgi SYNO.API.Auth");
    expect(requests.filter((line) => line.includes("SYNO.API.Info"))).toHaveLength(1);
  });

  it("stops trying after a rejected login so DSM never blocks SafeHub", async () => {
    password = "wrong";
    store.saveSettings({ SYNOLOGY_PASSWORD: password }); // new settings: new session
    logins = 0;
    const first = await synology.getSynologyOverview();
    const second = await synology.getSynologyOverview();
    expect(first).toMatchObject({ status: "error", message: "Synology login failed: wrong account or password" });
    expect(second.status === "error" && second.message).toContain("Next attempt in 5 min");
    expect(logins).toBe(1);
    // Saving an unrelated setting must not lift the backoff.
    store.saveSettings({ SONARR_URL: "http://sonarr:8989" });
    const third = await synology.getSynologyOverview();
    expect(third.status === "error" && third.message).toContain("Next attempt in 5 min");
    expect(logins).toBe(1);
  });
});
