import "server-only";
import { z } from "zod";
import { fetchWithoutLeaks } from "../http";
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

const GUEST_AGENT_ROLE = "SafeHubGuestAgent";
// Read-only privilege for asking the QEMU guest agent for VM addresses
// (Proxmox VE 9). Proxmox VE 8 only has VM.Monitor for that call, which also
// allows running commands and writing files inside every VM through the
// agent, so SafeHub never grants it.
const GUEST_AGENT_PRIVILEGE = "VM.GuestAgent.Audit";

type Call = (method: string, path: string, params?: Record<string, string>) => Promise<unknown>;

// A failed wizard call. Proxmox puts the reason in the status text and, for
// rejected parameters, per parameter in the body ("errors").
export class ProxmoxCallError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Proxmox VE 8 rejects the privilege name itself: 400 "Parameter verification
// failed." with "invalid privilege 'VM.GuestAgent.Audit'" for privs. Only that
// answer means "older Proxmox"; anything else (timeout, 5xx, missing
// Sys.Modify) is a real failure.
function isUnknownPrivilege(error: unknown): boolean {
  return (
    error instanceof ProxmoxCallError &&
    error.status === 400 &&
    (/invalid privilege/i.test(error.message) || error.message.includes(GUEST_AGENT_PRIVILEGE))
  );
}

// Returns the role name, or undefined when VM.GuestAgent.Audit does not exist
// (Proxmox VE 8). In that case a role left by an older SafeHub version (which
// granted VM.Monitor) is removed again. Other errors are thrown.
async function ensureGuestAgentRole(call: Call): Promise<string | undefined> {
  try {
    await call("POST", "access/roles", { roleid: GUEST_AGENT_ROLE, privs: GUEST_AGENT_PRIVILEGE });
    return GUEST_AGENT_ROLE;
  } catch (error) {
    if (/already exists/i.test((error as Error).message)) {
      // Left from an earlier run: set its privilege again.
      try {
        await call("PUT", `access/roles/${GUEST_AGENT_ROLE}`, { privs: GUEST_AGENT_PRIVILEGE });
        return GUEST_AGENT_ROLE;
      } catch (updateError) {
        if (!isUnknownPrivilege(updateError)) throw updateError;
      }
    } else if (!isUnknownPrivilege(error)) {
      throw error;
    }
  }
  await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: GUEST_AGENT_ROLE, delete: "1" }).catch(
    () => undefined,
  );
  await call("DELETE", `access/roles/${GUEST_AGENT_ROLE}`).catch(() => undefined);
  return undefined;
}

const errorBodySchema = z.object({ errors: z.record(z.string(), z.string()).optional() });

// " (privs: invalid privilege ...)" from Proxmox's per-parameter errors.
async function parameterErrors(response: { text(): Promise<string> }): Promise<string> {
  try {
    const parsed = errorBodySchema.safeParse(JSON.parse(await response.text()));
    const errors = parsed.success ? Object.entries(parsed.data.errors ?? {}) : [];
    if (errors.length === 0) return "";
    return ` (${errors.map(([name, text]) => `${name}: ${text.trim()}`).join("; ")})`;
  } catch {
    return "";
  }
}

const tokenSchema = z.object({
  data: z.object({ "full-tokenid": z.string(), value: z.string() }),
});

const tokenListSchema = z.object({
  data: z.array(z.object({ tokenid: z.string() })).nullable(),
});

export type ProxmoxTokenResult = {
  tokenId: string;
  secret: string;
  // False on Proxmox VE 8: VM addresses from the guest agent stay hidden.
  guestAgentAddresses: boolean;
  // Deletes the user's other tokens. Call it only after the new token is
  // saved, so a failure before that leaves the old token working.
  removeOldTokens: () => Promise<void>;
  // Deletes the token just created. For when saving it failed: its secret is
  // lost then, so it would stay on Proxmox unused.
  removeNewToken: () => Promise<void>;
};

export async function createProxmoxToken(input: {
  url: string;
  username: string;
  password: string;
  allowControl: boolean;
}): Promise<ProxmoxTokenResult> {
  const base = new URL("/api2/json/", input.url);
  const dispatcher = proxmoxTlsAgent(); // also pins the certificate on first use
  let auth: Record<string, string> = {};

  async function call(method: string, path: string, params: Record<string, string> = {}) {
    // Never follows a redirect for a POST/PUT/DELETE, so the admin password
    // and the login ticket cannot end up at a redirect target.
    const { response } = await fetchWithoutLeaks("Proxmox", new URL(path, base), {
      method,
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...auth },
      body: method === "GET" || method === "DELETE" ? undefined : new URLSearchParams(params).toString(),
      dispatcher,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProxmoxCallError(
        response.status,
        `Proxmox ${response.status} ${response.statusText}${await parameterErrors(response)}`.trim(),
      );
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

  // 3. Rights, set before any token changes so a failure here leaves an
  //    existing token as it was. Read everything; start/stop guests only when
  //    asked.
  await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEAuditor", propagate: "1" });
  // PVEAuditor cannot ask the QEMU guest agent, so VMs would show no address
  // and nothing could be placed under them. A small extra role adds that.
  const agentRole = await ensureGuestAgentRole(call);
  if (agentRole) {
    await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: agentRole, propagate: "1" });
  }
  if (input.allowControl) {
    await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEVMUser", propagate: "1" });
  } else {
    await call("PUT", "access/acl", { path: "/", users: SAFEHUB_USER, roles: "PVEVMUser", delete: "1" }).catch(
      () => undefined,
    );
  }

  // 4. New token next to the existing ones. Without privilege separation it
  //    has exactly the user's rights from step 3. The old token keeps working
  //    until the caller has saved the new one and calls removeOldTokens().
  const existing = tokenListSchema.parse(await call("GET", `access/users/${SAFEHUB_USER}/token`)).data ?? [];
  const names = existing.map((token) => token.tokenid);
  const name = names.includes(TOKEN_NAME) ? `${TOKEN_NAME}-${Date.now().toString(36)}` : TOKEN_NAME;
  const token = tokenSchema.parse(
    await call("POST", `access/users/${SAFEHUB_USER}/token/${name}`, {
      privsep: "0",
      comment: "SafeHub dashboard",
    }),
  ).data;

  return {
    tokenId: token["full-tokenid"],
    secret: token.value,
    guestAgentAddresses: agentRole !== undefined,
    async removeOldTokens() {
      for (const old of names.filter((candidate) => candidate !== name)) {
        await call("DELETE", `access/users/${SAFEHUB_USER}/token/${encodeURIComponent(old)}`);
      }
    },
    async removeNewToken() {
      await call("DELETE", `access/users/${SAFEHUB_USER}/token/${encodeURIComponent(name)}`);
    },
  };
}
