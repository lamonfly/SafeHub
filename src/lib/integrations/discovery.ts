import "server-only";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// Auto-setup: each app's config folder can be mounted read-only at
// ./appdata/<name> (inside the container: /app/appdata/<name>). SafeHub reads
// the app's own config file for its API key, port and URL base, and uses
// <name> as the host, which matches the container name on a shared Docker
// network (http://sonarr:8989). Explicit <APP>_URL / <APP>_API_KEY settings
// always win over what is found here.

export type DiscoverableApp = "sonarr" | "radarr" | "prowlarr" | "bazarr" | "seerr";
export type DiscoveredApp = { url: string; apiKey: string; folder: string };

const APPDATA_DIR = "./appdata";

// Default ports, also used to tell *arr apps apart when the folder name and
// the config file do not say which one it is.
const arrPorts: Record<string, DiscoverableApp> = {
  "8989": "sonarr",
  "7878": "radarr",
  "9696": "prowlarr",
};

function appFromName(name: string): DiscoverableApp | undefined {
  const lower = name.toLowerCase();
  if (lower.includes("seerr")) return "seerr"; // seerr, jellyseerr, overseerr
  return (["sonarr", "radarr", "prowlarr", "bazarr"] as const).find((app) => lower.includes(app));
}

function normalizeUrlBase(urlBase: string | undefined): string {
  const trimmed = (urlBase ?? "").trim().replace(/\/+$/, "");
  return !trimmed ? "" : trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function xmlTag(xml: string, tag: string): string | undefined {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1]?.trim();
}

function readFirst(folder: string, candidates: string[]): string | undefined {
  for (const file of candidates) {
    const path = join(folder, file);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  return undefined;
}

const bazarrSchema = z.object({
  auth: z.object({ apikey: z.string().min(1) }),
  general: z
    .object({ port: z.coerce.number().optional(), base_url: z.string().nullish() })
    .optional(),
});

const seerrSchema = z.object({ main: z.object({ apiKey: z.string().min(1) }) });

// Reads one mounted folder. Returns undefined when it holds no known config.
function discoverFolder(name: string): { app: DiscoverableApp; found: DiscoveredApp } | undefined {
  const folder = join(APPDATA_DIR, name);

  // Sonarr, Radarr, Prowlarr
  const xml = readFirst(folder, ["config.xml"]);
  if (xml) {
    const apiKey = xmlTag(xml, "ApiKey");
    const port = xmlTag(xml, "Port");
    const app =
      appFromName(xmlTag(xml, "InstanceName") ?? "") ?? appFromName(name) ?? arrPorts[port ?? ""];
    if (!apiKey || !port || !app) return undefined;
    const url = `http://${name}:${port}${normalizeUrlBase(xmlTag(xml, "UrlBase"))}`;
    return { app, found: { url, apiKey, folder: name } };
  }

  // Bazarr (config/config.yaml inside its /config folder)
  const yaml = readFirst(folder, ["config/config.yaml", "config.yaml"]);
  if (yaml) {
    const parsed = bazarrSchema.safeParse(parseYaml(yaml));
    if (!parsed.success) return undefined;
    const port = parsed.data.general?.port ?? 6767;
    const url = `http://${name}:${port}${normalizeUrlBase(parsed.data.general?.base_url ?? "")}`;
    return { app: "bazarr", found: { url, apiKey: parsed.data.auth.apikey, folder: name } };
  }

  // Seerr / Jellyseerr / Overseerr (port is set by the container, default 5055)
  const json = readFirst(folder, ["settings.json", "config/settings.json"]);
  if (json) {
    const parsed = seerrSchema.safeParse(JSON.parse(json));
    if (!parsed.success) return undefined;
    return {
      app: "seerr",
      found: { url: `http://${name}:5055`, apiKey: parsed.data.main.apiKey, folder: name },
    };
  }

  return undefined;
}

function discoverApps(): Partial<Record<DiscoverableApp, DiscoveredApp>> {
  if (!existsSync(APPDATA_DIR)) return {};
  const apps: Partial<Record<DiscoverableApp, DiscoveredApp>> = {};
  for (const entry of readdirSync(APPDATA_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const result = discoverFolder(entry.name);
      // The folder name becomes the host: one that is not a valid host name
      // (e.g. "Sonarr Config") would make building the client throw and take
      // the dashboard down, so skip it here.
      if (result && !/^[A-Za-z0-9]([A-Za-z0-9_.-]*[A-Za-z0-9])?$/.test(entry.name)) {
        throw new Error("the folder name is not a valid host name; name it like the container (e.g. sonarr)");
      }
      if (result) new URL(result.found.url);
      // First folder per app wins; a second Sonarr would need explicit settings.
      if (result && !apps[result.app]) apps[result.app] = result.found;
    } catch (error) {
      console.warn(`Auto-setup: could not read ./appdata/${entry.name}: ${(error as Error).message}`);
    }
  }
  return apps;
}

export const discovered = discoverApps();

// Picks the explicit setting when present, otherwise the discovered value.
export function resolveService(
  app: DiscoverableApp,
  url: string | undefined,
  apiKey: string | undefined,
): { url: string; apiKey: string } | null {
  const found = discovered[app];
  const resolvedUrl = url ?? found?.url;
  const resolvedKey = apiKey ?? found?.apiKey;
  return resolvedUrl && resolvedKey ? { url: resolvedUrl, apiKey: resolvedKey } : null;
}
