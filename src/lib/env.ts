import "server-only";
import { z } from "zod";

// Integrations are optional: an unset URL means "not configured", and the
// dashboard shows that state instead of failing. Set values must be valid.
const optionalUrl = z.url().optional();
const optionalSecret = z.string().min(1).optional();
const optionalFlag = z.stringbool().default(false);

const envSchema = z.object({
  // Core: these are required.
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
  DATABASE_PATH: z.string().min(1).default("./data/safehub.db"),

  // Proxmox VE: API token auth, e.g. PROXMOX_TOKEN_ID="user@pam!safehub"
  PROXMOX_URL: optionalUrl,
  PROXMOX_TOKEN_ID: optionalSecret,
  PROXMOX_TOKEN_SECRET: optionalSecret,
  PROXMOX_CA_CERT_PATH: optionalSecret,
  PROXMOX_ALLOW_SELF_SIGNED: optionalFlag,

  // Synology DSM
  SYNOLOGY_URL: optionalUrl,
  SYNOLOGY_USERNAME: optionalSecret,
  SYNOLOGY_PASSWORD: optionalSecret,
  SYNOLOGY_CA_CERT_PATH: optionalSecret,
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
  CADDY_ADMIN_URL: optionalUrl,
});

export type Env = z.infer<typeof envSchema>;

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
  return result.data;
}

export const env = parseEnv();
