import "server-only";
import { fetch } from "undici";
import { z } from "zod";
import { proxmoxTlsAgent } from ".";

// One-time setup: log in with an admin account, create a dedicated user and
// API token for SafeHub with only the rights it needs, and return the token.
// The admin password is used for this one login and never stored.

const SAFEHUB_USER = "safehub@pve";
const TOKEN_NAME = "safehub";
const TIMEOUT_MS = 10_000;

const ticketSchema = z.object({
  data: z
    .object({
      ticket: z.string().optional(),
      CSRFPreventionToken: z.string().optional(),
      NeedTFA: z.unknown().optional(),
    })
    .nullable(),
});

const tokenSchema = z.object({
  data: z.object({ "full-tokenid": z.string(), value: z.string() }),
});

export async function createProxmoxToken(input: {
  url: string;
  username: string;
  password: string;
  allowControl: boolean;
}): Promise<{ tokenId: string; secret: string }> {
  const base = new URL("/api2/json/", input.url);
  const dispatcher = proxmoxTlsAgent(); // also pins the certificate on first use
  let auth: Record<string, string> = {};

  async function call(method: string, path: string, params: Record<string, string> = {}) {
    const response = await fetch(new URL(path, base), {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...auth },
      body: method === "GET" || method === "DELETE" ? undefined : new URLSearchParams(params).toString(),
      dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      // Proxmox puts the reason in the status text.
      throw new Error(`Proxmox ${response.status} ${response.statusText}`.trim());
    }
    return response.json();
  }

  // 1. Log in.
  const login = ticketSchema.parse(
    await call("POST", "access/ticket", { username: input.username, password: input.password }),
  ).data;
  if (login?.NeedTFA) {
    throw new Error("This account uses two-factor login. Use another admin account or create the token manually.");
  }
  if (!login?.ticket || !login.CSRFPreventionToken) throw new Error("Proxmox login failed.");
  auth = { Cookie: `PVEAuthCookie=${login.ticket}`, CSRFPreventionToken: login.CSRFPreventionToken };

  // 2. Dedicated user (no password: it can only be used through its token).
  await call("POST", "access/users", { userid: SAFEHUB_USER, comment: "SafeHub dashboard" }).catch(
    (error: Error) => {
      if (!/already exists/i.test(error.message)) throw error;
    },
  );

  // 3. Fresh token. Without privilege separation it has exactly the user's
  //    rights, which are limited to what step 4 grants.
  await call("DELETE", `access/users/${SAFEHUB_USER}/token/${TOKEN_NAME}`).catch(() => undefined);
  const token = tokenSchema.parse(
    await call("POST", `access/users/${SAFEHUB_USER}/token/${TOKEN_NAME}`, {
      privsep: "0",
      comment: "SafeHub dashboard",
    }),
  ).data;

  // 4. Rights: read everything; start/stop guests only when asked.
  await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEAuditor", propagate: "1" });
  if (input.allowControl) {
    await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEVMUser", propagate: "1" });
  } else {
    await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEVMUser", delete: "1" }).catch(
      () => undefined,
    );
  }

  return { tokenId: token["full-tokenid"], secret: token.value };
}
