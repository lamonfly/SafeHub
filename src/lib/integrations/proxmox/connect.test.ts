import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttps } from "../../../../tests/support/helpers";

// Fake Proxmox for the "Connect with password" wizard.
const calls: string[] = [];
let userExists = false;
let server: Awaited<ReturnType<typeof startHttps>>;
let connect: typeof import("./connect");
let proxmox: typeof import(".");
let store: typeof import("@/lib/settings/store");

beforeAll(async () => {
  server = await startHttps((request, body, response) => {
    const path = request.url!.replace("/api2/json/", "");
    const params = new URLSearchParams(body);
    if (path === "access/ticket") {
      if (params.get("password") === "tfa") return json(response, { data: { NeedTFA: 1, ticket: "t", CSRFPreventionToken: "c" } });
      if (params.get("password") !== "rootpw") return json(response, { data: null }, 401, "authentication failure");
      return json(response, { data: { ticket: "TICKET", CSRFPreventionToken: "CSRF" } });
    }
    // Dashboard calls use the new token, wizard calls the login ticket.
    if (path === "nodes" || path.startsWith("cluster/resources")) {
      if (request.headers.authorization !== "PVEAPIToken=safehub@pve!safehub=token-secret") return json(response, { data: null }, 401, "invalid token");
      return json(response, { data: path === "nodes" ? [{ node: "pve", status: "online" }] : [] });
    }
    if (request.headers.cookie !== "PVEAuthCookie=TICKET" || request.headers.csrfpreventiontoken !== "CSRF") {
      return json(response, { data: null }, 401, "no ticket");
    }
    calls.push(`${request.method} ${path} ${body}`);
    if (request.method === "POST" && path === "access/users") {
      if (userExists) return json(response, { data: null }, 500, "user 'safehub@pve' already exists");
      userExists = true;
      return json(response, { data: null });
    }
    if (request.method === "POST" && path.startsWith("access/users/safehub@pve/token/")) {
      return json(response, { data: { "full-tokenid": "safehub@pve!safehub", value: "token-secret" } });
    }
    return json(response, { data: null });
  });
  await migratedDb();
  connect = await import("./connect");
  proxmox = await import(".");
  store = await import("@/lib/settings/store");
});
afterAll(() => server.close());

const input = (password: string, allowControl = true) => ({ url: server.url, username: "root@pam", password, allowControl });
const failure = (promise: Promise<unknown>) => promise.then(() => "ok", (error: Error) => error.message);

describe("Proxmox wizard", () => {
  it("explains a wrong password and two-factor accounts", async () => {
    expect(await failure(connect.createProxmoxToken(input("nope")))).toBe("Proxmox 401 authentication failure");
    expect(await failure(connect.createProxmoxToken(input("tfa")))).toContain("two-factor");
  });

  it("creates the user, token and rights, and the dashboard works right away", async () => {
    const token = await connect.createProxmoxToken(input("rootpw"));
    expect(token).toEqual({ tokenId: "safehub@pve!safehub", secret: "token-secret" });
    expect(calls.some((line) => line.startsWith("POST access/users userid=safehub%40pve"))).toBe(true);
    expect(calls.some((line) => line.includes("roles=PVEAuditor"))).toBe(true);
    expect(calls.some((line) => line.includes("roles=PVEVMUser&propagate"))).toBe(true);

    store.saveSettings({ PROXMOX_URL: server.url, PROXMOX_TOKEN_ID: token.tokenId, PROXMOX_TOKEN_SECRET: token.secret });
    expect(proxmox.isProxmoxConfigured()).toBe(true);
    expect((await proxmox.getProxmoxOverview()).status).toBe("ok");
  });

  it("can run again and remove the start/stop right", async () => {
    calls.length = 0;
    await connect.createProxmoxToken(input("rootpw", false));
    expect(calls.some((line) => line.includes("roles=PVEVMUser&delete=1"))).toBe(true);
  });
});
