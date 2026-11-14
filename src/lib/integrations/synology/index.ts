import "server-only";
import { fetch, type Agent } from "undici";
import { z } from "zod";
import { env } from "@/lib/env";
import { perSettings } from "@/lib/settings/memo";
import { getFlag, getSetting } from "@/lib/settings/store";
import { cacheFor } from "../cache";
import { attempt, type IntegrationResult } from "../result";
import { createTlsAgent } from "../tls";

// DSM Web API: log in once, reuse the session id (sid), log in again when
// DSM reports the session expired. All calls use POST so the password never
// appears in a URL or DSM's access log.

const TIMEOUT_MS = 5_000;
const SESSION_ERRORS = new Set([106, 107, 119]); // timeout, interrupted, invalid sid

const loginErrors: Record<number, string> = {
  400: "wrong account or password",
  401: "account disabled",
  402: "permission denied",
  403: "2-factor code required; use an account without 2FA",
  404: "2-factor authentication failed",
  406: "2-factor authentication enforced; use an account without 2FA",
  407: "IP blocked by DSM auto-block",
  408: "password expired",
  409: "password expired",
  410: "password must be changed",
};

// Common errors for any DSM API call.
const apiErrors: Record<number, string> = {
  102: "API not available on this DSM version",
  103: "method not available",
  104: "version not supported",
  105: "permission denied; the SafeHub user must be in the administrators group",
};

class DsmError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

const envelopeSchema = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({ code: z.number() }).optional(),
});

type Config = { webapi: URL; username: string; password: string; dispatcher: Agent };

const getConfig = perSettings((): Config | null => {
  // New settings: forget the old session, API paths and login backoff.
  apiInfo = undefined;
  session = undefined;
  loginBlocked = undefined;

  const url = getSetting("SYNOLOGY_URL");
  const username = getSetting("SYNOLOGY_USERNAME");
  const password = getSetting("SYNOLOGY_PASSWORD");
  if (!url || !username || !password) return null;
  return {
    webapi: new URL("/webapi/", url),
    username,
    password,
    dispatcher: createTlsAgent({
      pinName: "synology",
      caCertPath: env.SYNOLOGY_CA_CERT_PATH,
      allowSelfSigned: getFlag("SYNOLOGY_ALLOW_SELF_SIGNED"),
    }),
  };
});

// The dashboard hides the Synology card when this is false.
export function isSynologyConfigured(): boolean {
  return getConfig() !== null;
}

async function post<T extends z.ZodType>(
  config: Config,
  cgi: string,
  params: Record<string, string>,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetch(new URL(cgi, config.webapi), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    dispatcher: config.dispatcher,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Synology ${response.status} ${response.statusText}`.trim());

  const body = envelopeSchema.parse(await response.json());
  if (!body.success) {
    const code = body.error?.code ?? 0;
    const reason = apiErrors[code] ? `: ${apiErrors[code]}` : "";
    throw new DsmError(code, `Synology API error ${code} (${params.api})${reason}`);
  }
  return schema.parse(body.data);
}

// Where each API lives differs between DSM versions (DSM 6 serves login from
// auth.cgi, DSM 7 from entry.cgi), so ask SYNO.API.Info once instead of
// hard-coding paths. query.cgi needs no login.
const USED_APIS = [
  "SYNO.API.Auth",
  "SYNO.Core.System",
  "SYNO.Core.System.Utilization",
  "SYNO.Storage.CGI.Storage",
];

const apiInfoSchema = z.record(
  z.string(),
  z.object({ path: z.string(), minVersion: z.number(), maxVersion: z.number() }),
);

let apiInfo: Promise<z.infer<typeof apiInfoSchema>> | undefined;

function getApiInfo(config: Config) {
  if (!apiInfo) {
    const pending = post(
      config,
      "query.cgi",
      { api: "SYNO.API.Info", version: "1", method: "query", query: USED_APIS.join(",") },
      apiInfoSchema,
    );
    pending.catch(() => {
      if (apiInfo === pending) apiInfo = undefined;
    });
    apiInfo = pending;
  }
  return apiInfo;
}

// Calls an API at its advertised path, using the requested version or the
// highest one this DSM supports, whichever is lower.
async function call<T extends z.ZodType>(
  config: Config,
  params: Record<string, string> & { api: string; version: string },
  schema: T,
): Promise<z.infer<T>> {
  const info = (await getApiInfo(config))[params.api];
  if (!info) throw new Error(`Synology: ${params.api} is not available on this DSM version`);
  const version = Math.min(Number(params.version), info.maxVersion);
  if (version < info.minVersion) {
    throw new Error(`Synology: ${params.api} needs version ${info.minVersion}+; SafeHub uses ${params.version}`);
  }
  try {
    return await post(config, info.path, { ...params, version: String(version) }, schema);
  } catch (error) {
    // API moved (e.g. after a DSM upgrade): look the paths up again next time.
    if (error instanceof DsmError && error.code === 102) apiInfo = undefined;
    throw error;
  }
}

// Shared so parallel calls wait for one login instead of each logging in.
// The session is never logged out: a container restart leaves it behind, and
// DSM expires idle sessions on its own. Logging out on SIGTERM would race
// Next's own shutdown for little gain.
let session: Promise<string> | undefined;

function getSid(config: Config, expired?: Promise<string>): Promise<string> {
  // Only replace the session that failed; another call may have renewed it already.
  if (!session || session === expired) {
    const pending = login(config);
    pending.catch(() => {
      if (session === pending) session = undefined;
    });
    session = pending;
  }
  return session;
}

// After a rejected login, stop trying for a while. Retrying on every refresh
// would trip DSM auto-block, which bans this host's IP from all of DSM.
const LOGIN_BACKOFF_MS = 5 * 60_000;
let loginBlocked: { until: number; message: string } | undefined;

async function login(config: Config): Promise<string> {
  if (loginBlocked && Date.now() < loginBlocked.until) {
    const minutes = Math.ceil((loginBlocked.until - Date.now()) / 60_000);
    throw new Error(`${loginBlocked.message}. Next attempt in ${minutes} min.`);
  }
  try {
    const data = await call(
      config,
      {
        api: "SYNO.API.Auth",
        version: "6",
        method: "login",
        account: config.username,
        passwd: config.password,
        session: "SafeHub",
        format: "sid",
      },
      z.object({ sid: z.string() }),
    );
    loginBlocked = undefined;
    return data.sid;
  } catch (error) {
    if (error instanceof DsmError && loginErrors[error.code]) {
      const message = `Synology login failed: ${loginErrors[error.code]}`;
      loginBlocked = { until: Date.now() + LOGIN_BACKOFF_MS, message };
      throw new Error(message);
    }
    throw error;
  }
}

async function authedCall<T extends z.ZodType>(
  config: Config,
  params: Record<string, string> & { api: string; version: string },
  schema: T,
): Promise<z.infer<T>> {
  const current = getSid(config);
  try {
    return await call(config, { ...params, _sid: await current }, schema);
  } catch (error) {
    if (!(error instanceof DsmError && SESSION_ERRORS.has(error.code))) throw error;
    return call(config, { ...params, _sid: await getSid(config, current) }, schema);
  }
}

// DSM returns many numbers as strings; field sets vary between versions.
const number = z.coerce.number();

const utilizationSchema = z.object({
  cpu: z.object({
    user_load: number.default(0),
    system_load: number.default(0),
    other_load: number.default(0),
  }),
  memory: z.object({
    real_usage: number.default(0), // percent
    total_real: number.default(0), // KiB
  }),
});

const systemInfoSchema = z.object({
  model: z.string().optional(),
  firmware_ver: z.string().optional(),
  up_time: z.string().optional(), // "hours:minutes:seconds"
  sys_temp: number.optional(),
});

const storageSchema = z.object({
  volumes: z
    .array(
      z.object({
        id: z.string(),
        display_name: z.string().optional(),
        vol_path: z.string().optional(),
        status: z.string().default("unknown"),
        size: z.object({ total: number.default(0), used: number.default(0) }).optional(),
      }),
    )
    .default([]),
  disks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        model: z.string().optional(),
        status: z.string().default("unknown"),
        temp: number.optional(),
      }),
    )
    .default([]),
});

export type SynologyOverview = {
  model?: string;
  firmware?: string;
  uptimeSeconds?: number;
  temperature?: number;
  cpuPercent: number;
  memory: { usedPercent: number; totalBytes: number };
  volumes: { name: string; status: string; usedBytes: number; totalBytes: number }[];
  disks: { name: string; model?: string; status: string; temperature?: number }[];
};

function parseUptime(value?: string): number | undefined {
  const parts = value?.split(":").map(Number);
  if (!parts || parts.length !== 3 || parts.some(Number.isNaN)) return undefined;
  return parts[0] * 3_600 + parts[1] * 60 + parts[2];
}

// CPU/RAM are live; 5 s only merges parallel tabs. System info and storage
// change slowly, and load_info is heavy on DSM, so they refresh once a minute.
// Rebuilt with the settings, so a changed account never sees cached data.
const getUtilization = perSettings(() =>
  cacheFor(5_000, (config: Config) =>
    authedCall(config, { api: "SYNO.Core.System.Utilization", version: "1", method: "get" }, utilizationSchema),
  ),
);
const getSystemAndStorage = perSettings(() =>
  cacheFor(60_000, (config: Config) =>
    Promise.all([
      authedCall(config, { api: "SYNO.Core.System", version: "1", method: "info" }, systemInfoSchema),
      authedCall(config, { api: "SYNO.Storage.CGI.Storage", version: "1", method: "load_info" }, storageSchema),
    ]),
  ),
);

export async function getSynologyOverview(): Promise<IntegrationResult<SynologyOverview>> {
  const config = getConfig();
  if (!config) return { status: "not-configured" };
  return attempt(async () => {
    const [utilization, [info, storage]] = await Promise.all([
      getUtilization()(config),
      getSystemAndStorage()(config),
    ]);
    const { cpu, memory } = utilization;
    return {
      model: info.model,
      firmware: info.firmware_ver,
      uptimeSeconds: parseUptime(info.up_time),
      temperature: info.sys_temp,
      cpuPercent: cpu.user_load + cpu.system_load + cpu.other_load,
      memory: { usedPercent: memory.real_usage, totalBytes: memory.total_real * 1024 },
      volumes: storage.volumes.map((volume) => ({
        name: volume.display_name ?? volume.vol_path ?? volume.id,
        status: volume.status,
        usedBytes: volume.size?.used ?? 0,
        totalBytes: volume.size?.total ?? 0,
      })),
      disks: storage.disks.map((disk) => ({
        name: disk.name ?? disk.id,
        model: disk.model?.trim(),
        status: disk.status,
        temperature: disk.temp,
      })),
    };
  });
}
