import "server-only";
import { randomBytes } from "node:crypto";
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { httpUrl } from "@/lib/url";

// Integrations are optional: an unset URL means "not configured", and the
// dashboard shows that state instead of failing. Set values must be valid.
// URLs: http/https only, no user:password@ (see lib/url.ts).
const optionalUrl = httpUrl.optional();
const optionalSecret = z.string().min(1).optional();
const optionalFlag = z.stringbool().default(false);
// Checked at boot so a wrong path stops the server with a clear message,
// instead of breaking the page that loads the integration.
const optionalReadableFile = z
  .string()
  .min(1)
  .refine((path) => {
    try {
      accessSync(path, constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }, "File not found or not readable.")
  .optional();

const envSchema = z.object({
  // Core. All optional so a bare `docker compose up -d` works:
  // - no secret: one is generated on first start and kept next to the database
  // - no URL: SafeHub works at whatever address it is opened with
  BETTER_AUTH_SECRET: z.string().min(32).optional(),
  BETTER_AUTH_URL: optionalUrl,
  // Extra addresses SafeHub is opened at, comma-separated, e.g. the LAN IP
  // when BETTER_AUTH_URL is the Caddy domain.
  BETTER_AUTH_TRUSTED_ORIGINS: z
    .string()
    .default("")
    .transform((value) => value.split(",").map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(httpUrl)),
  DATABASE_PATH: z.string().min(1).default("./data/safehub.db"),

  // Proxmox VE: API token auth, e.g. PROXMOX_TOKEN_ID="user@pam!safehub"
  PROXMOX_URL: optionalUrl,
  PROXMOX_TOKEN_ID: optionalSecret,
  PROXMOX_TOKEN_SECRET: optionalSecret,
  PROXMOX_CA_CERT_PATH: optionalReadableFile,
  PROXMOX_ALLOW_SELF_SIGNED: optionalFlag,
  // Alert when a guest's newest backup is older than this (default 7).
  PROXMOX_BACKUP_MAX_AGE_DAYS: z.string().regex(/^[1-9]\d{0,2}$/,"Whole number of days (1-999).").optional(),

  // Synology DSM
  SYNOLOGY_URL: optionalUrl,
  SYNOLOGY_USERNAME: optionalSecret,
  SYNOLOGY_PASSWORD: optionalSecret,
  SYNOLOGY_CA_CERT_PATH: optionalReadableFile,
  SYNOLOGY_ALLOW_SELF_SIGNED: optionalFlag,

  // *arr stack
  SONARR_URL: optionalUrl,
  SONARR_API_KEY: optionalSecret,
  RADARR_URL: optionalUrl,
  RADARR_API_KEY: optionalSecret,
  PROWLARR_URL: optionalUrl,
  PROWLARR_API_KEY: optionalSecret,
  BAZARR_URL: optionalUrl,
  BAZARR_API_KEY: optionalSecret,

  // Media and apps
  JELLYFIN_URL: optionalUrl,
  JELLYFIN_API_KEY: optionalSecret,
  SEERR_URL: optionalUrl,
  SEERR_API_KEY: optionalSecret,
  IMMICH_URL: optionalUrl,
  IMMICH_API_KEY: optionalSecret,

  // Downloads: qBittorrent Web UI (login optional) and Gluetun's control server.
  QBITTORRENT_URL: optionalUrl,
  QBITTORRENT_USERNAME: optionalSecret,
  QBITTORRENT_PASSWORD: optionalSecret,
  GLUETUN_URL: optionalUrl,
  GLUETUN_API_KEY: optionalSecret,

  // Docker socket mounted into the container; Docker is hidden without it.
  DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),

  // Push notifications via ntfy (opt-in: nothing is sent without a topic).
  NTFY_URL: optionalUrl,
  NTFY_TOPIC: optionalSecret,
  NTFY_TOKEN: optionalSecret,
  NTFY_CRITICAL_ONLY: optionalFlag,

  // Turns off the update check against GitHub.
  DISABLE_UPDATE_CHECK: optionalFlag,
});

type ParsedEnv = z.infer<typeof envSchema>;
export type Env = ParsedEnv & { BETTER_AUTH_SECRET: string };

// Reads the generated secret, or creates it on first start. Losing the file
// only signs everyone out; it is not needed to read the database.
function loadOrCreateAuthSecret(databasePath: string): string {
  const path = join(dirname(databasePath), "auth-secret");
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dirname(path), { recursive: true });
  try {
    // "wx": never overwrite a secret another process wrote in the meantime.
    writeFileSync(path, `${randomBytes(32).toString("base64")}\n`, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return readFileSync(path, "utf8").trim();
}

function parseEnv(): Env {
  // Treat empty values (e.g. "SONARR_URL=") as unset.
  const values = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== ""),
  );
  const result = envSchema.safeParse(values);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  const data = result.data;
  return {
    ...data,
    BETTER_AUTH_SECRET: data.BETTER_AUTH_SECRET ?? loadOrCreateAuthSecret(data.DATABASE_PATH),
  };
}

export const env = parseEnv();
