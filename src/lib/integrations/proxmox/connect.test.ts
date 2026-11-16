import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { json, migratedDb, startHttp, startHttps } from "../../../../tests/support/helpers";

// Fake Proxmox for the "Connect with password" wizard.
const calls: string[] = [];
let userExists = false;
let proxmox8 = false;
let aclFails = false;
// Guest agent role: already there from an earlier run, or failing for
// another reason than an unknown privilege.
let roleExists = false;
let roleCreateFailure: [number, string] | undefined;
let roleUpdateFailure: [number, string] | undefined;
// Answers the login with a redirect to another server.
let redirectLogin = false;
const redirectTargetRequests: string[] = [];
let redirectTarget: Awaited<ReturnType<typeof startHttp>>;
// Tokens of safehub@pve on the fake Proxmox.
const tokens = new Set<string>();
let server: Awaited<ReturnType<typeof startHttps>>;
let connect: typeof import("./connect");
let proxmox: typeof import(".");
let store: typeof import("@/lib/settings/store");

// Proxmox VE 8's answer to a privilege it does not know.
function invalidPrivilege(response: Parameters<typeof json>[0]) {
  json(response, { data: null, errors: { privs: "invalid format - invalid privilege 'VM.GuestAgent.Audit'\n" } }, 400, "Parameter verification failed.");
}

beforeAll(async () => {
  redirectTarget = await startHttp((request, body, response) => {
    redirectTargetRequests.push(`${request.method} ${request.url} ${body} ${JSON.stringify(request.headers)}`);
    json(response, { data: { ticket: "STOLEN", CSRFPreventionToken: "STOLEN" } });
  });
  server = await startHttps((request, body, response) => {
    const path = request.url!.replace("/api2/json/", "");
    const params = new URLSearchParams(body);
    if (path === "access/ticket" && redirectLogin) {
      response.writeHead(307, { Location: `${redirectTarget.url}/api2/json/access/ticket` });
      return response.end();
    }
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
    // Proxmox VE 8 does not know VM.GuestAgent.Audit.
    const privs = params.get("privs");
    if ((path === "access/roles" || path === "access/roles/SafeHubGuestAgent") && proxmox8 && privs === "VM.GuestAgent.Audit") {
      return invalidPrivilege(response);
    }
    if (request.method === "POST" && path === "access/roles") {
      if (roleCreateFailure) return json(response, { data: null }, ...roleCreateFailure);
      if (roleExists) return json(response, { data: null }, 500, "create role failed: role 'SafeHubGuestAgent' already exists");
    }
    if (request.method === "PUT" && path === "access/roles/SafeHubGuestAgent" && roleUpdateFailure) {
      return json(response, { data: null }, ...roleUpdateFailure);
    }
    if (request.method === "PUT" && path === "access/acl" && aclFails) {
      return json(response, { data: null }, 500, "acl update failed");
    }
    if (request.method === "GET" && path === "access/users/safehub@pve/token") {
      return json(response, { data: [...tokens].map((tokenid) => ({ tokenid })) });
    }
    const tokenName = path.match(/^access\/users\/safehub@pve\/token\/(.+)$/)?.[1];
    if (tokenName && request.method === "POST") {
      if (tokens.has(tokenName)) return json(response, { data: null }, 500, "token already exists");
      tokens.add(tokenName);
      return json(response, { data: { "full-tokenid": `safehub@pve!${tokenName}`, value: "token-secret" } });
    }
    if (tokenName && request.method === "DELETE") tokens.delete(decodeURIComponent(tokenName));
    return json(response, { data: null });
  });
  await migratedDb();
  connect = await import("./connect");
  proxmox = await import(".");
  store = await import("@/lib/settings/store");
});
afterAll(async () => {
  await server.close();
  await redirectTarget.close();
});

const input = (password: string, allowControl = true) => ({ url: server.url, username: "root@pam", password, allowControl });
const failure = (promise: Promise<unknown>) => promise.then(() => "ok", (error: Error) => error.message);

describe("Proxmox wizard", () => {
  it("explains a wrong password and two-factor accounts", async () => {
    expect(await failure(connect.createProxmoxToken(input("nope")))).toBe("Proxmox 401 authentication failure");
    expect(await failure(connect.createProxmoxToken(input("tfa")))).toContain("two-factor");
  });

  it("creates the user, token and rights, and the dashboard works right away", async () => {
    const token = await connect.createProxmoxToken(input("rootpw"));
    expect(token).toMatchObject({ tokenId: "safehub@pve!safehub", secret: "token-secret", guestAgentAddresses: true });
    expect(calls.some((line) => line.startsWith("POST access/users userid=safehub%40pve"))).toBe(true);
    expect(calls.some((line) => line.includes("roles=PVEAuditor"))).toBe(true);
    expect(calls.some((line) => line.includes("roles=PVEVMUser&propagate"))).toBe(true);
    // VM addresses through the guest agent.
    expect(calls).toContain("POST access/roles roleid=SafeHubGuestAgent&privs=VM.GuestAgent.Audit");
    expect(calls.some((line) => line.includes("roles=SafeHubGuestAgent&propagate"))).toBe(true);

    store.saveSettings({ PROXMOX_URL: server.url, PROXMOX_TOKEN_ID: token.tokenId, PROXMOX_TOKEN_SECRET: token.secret });
    expect(proxmox.isProxmoxConfigured()).toBe(true);
    expect((await proxmox.getProxmoxOverview()).status).toBe("ok");
  });

  it("can run again and remove the start/stop right", async () => {
    calls.length = 0;
    const token = await connect.createProxmoxToken(input("rootpw", false));
    expect(calls.some((line) => line.includes("roles=PVEVMUser&delete=1"))).toBe(true);
    // A second token next to the first; the old one goes only when asked.
    expect(token.tokenId).toMatch(/^safehub@pve!safehub-/);
    expect(tokens.size).toBe(2);
    await token.removeOldTokens();
    expect([...tokens]).toEqual([token.tokenId.split("!")[1]]);
  });

  it("sets the rights before touching tokens, so a failure keeps the old token", async () => {
    calls.length = 0;
    const before = [...tokens];
    aclFails = true;
    expect(await failure(connect.createProxmoxToken(input("rootpw")))).toBe("Proxmox 500 acl update failed");
    aclFails = false;
    expect([...tokens]).toEqual(before);
    expect(calls.some((line) => line.includes("/token"))).toBe(false);
  });

  it("never grants VM.Monitor on Proxmox VE 8 and removes an old guest agent role", async () => {
    calls.length = 0;
    proxmox8 = true;
    const token = await connect.createProxmoxToken(input("rootpw"));
    proxmox8 = false;
    expect(token.guestAgentAddresses).toBe(false);
    expect(calls.some((line) => line.includes("VM.Monitor"))).toBe(false);
    expect(calls.some((line) => line.includes("roles=SafeHubGuestAgent&propagate"))).toBe(false);
    expect(calls.some((line) => line.includes("roles=SafeHubGuestAgent&delete=1"))).toBe(true);
    expect(calls).toContain("DELETE access/roles/SafeHubGuestAgent ");
    await token.removeOldTokens();
  });

  it("updates a guest agent role left from an earlier run", async () => {
    calls.length = 0;
    roleExists = true;
    const token = await connect.createProxmoxToken(input("rootpw"));
    roleExists = false;
    expect(token.guestAgentAddresses).toBe(true);
    expect(calls).toContain("PUT access/roles/SafeHubGuestAgent privs=VM.GuestAgent.Audit");
    expect(calls.some((line) => line.startsWith("DELETE access/roles"))).toBe(false);
    await token.removeOldTokens();
  });

  it("treats only an unknown privilege as Proxmox VE 8 when the role exists", async () => {
    calls.length = 0;
    roleExists = true;
    proxmox8 = true;
    const token = await connect.createProxmoxToken(input("rootpw"));
    expect(token.guestAgentAddresses).toBe(false);
    expect(calls).toContain("DELETE access/roles/SafeHubGuestAgent ");
    await token.removeOldTokens();

    // Any other failure of the update stops the wizard and keeps the role.
    proxmox8 = false;
    calls.length = 0;
    roleUpdateFailure = [500, "update role failed"];
    expect(await failure(connect.createProxmoxToken(input("rootpw")))).toBe("Proxmox 500 update role failed");
    roleUpdateFailure = undefined;
    roleExists = false;
    expect(calls.some((line) => line.startsWith("DELETE"))).toBe(false);
    expect(calls.some((line) => line.includes("roles=SafeHubGuestAgent&delete=1"))).toBe(false);
  });

  it.each([
    [500, "server busy", "Proxmox 500 server busy"],
    [403, "Permission check failed (/access, Sys.Modify)", "Proxmox 403 Permission check failed (/access, Sys.Modify)"],
  ] as const)("stops on a %s while creating the role instead of removing it", async (status, text, message) => {
    calls.length = 0;
    const before = [...tokens];
    roleCreateFailure = [status, text];
    expect(await failure(connect.createProxmoxToken(input("rootpw")))).toBe(message);
    roleCreateFailure = undefined;
    expect(calls.some((line) => line.startsWith("DELETE"))).toBe(false);
    expect(calls.some((line) => line.includes("roles=SafeHubGuestAgent&delete=1"))).toBe(false);
    expect(calls.some((line) => line.includes("/token"))).toBe(false);
    expect([...tokens]).toEqual(before);
  });

  it("stops on a 400 that is not about an unknown privilege", async () => {
    roleCreateFailure = [400, "Parameter verification failed."];
    // Not an unknown privilege: the wizard fails with Proxmox's own reason.
    expect(await failure(connect.createProxmoxToken(input("rootpw")))).toBe("Proxmox 400 Parameter verification failed.");
    roleCreateFailure = undefined;
  });

  it("removes the new token on request", async () => {
    const token = await connect.createProxmoxToken(input("rootpw"));
    const created = token.tokenId.split("!")[1];
    expect(tokens.has(created)).toBe(true);
    await token.removeNewToken();
    expect(tokens.has(created)).toBe(false);
    expect(tokens.size).toBeGreaterThan(0); // the old token stays
  });

  it("never sends the password to a redirect target", async () => {
    redirectLogin = true;
    const message = await failure(connect.createProxmoxToken(input("rootpw")));
    redirectLogin = false;
    expect(message).toContain("redirected to");
    expect(redirectTargetRequests).toEqual([]);
  });
});
