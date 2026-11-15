import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Auto-setup reads ./appdata once at import, so build a fake appdata folder,
// switch into it, then import the module.
let discovery: typeof import("./discovery");

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "safehub-appdata-"));
  const write = (path: string, content: string) => {
    mkdirSync(join(root, "appdata", path, ".."), { recursive: true });
    writeFileSync(join(root, "appdata", path), content);
  };
  write("sonarr/config.xml", "<Config><Port>8989</Port><ApiKey>sonarr-key</ApiKey><UrlBase></UrlBase><InstanceName>Sonarr</InstanceName></Config>");
  write("radarr/config.xml", "<Config><Port>7878</Port><ApiKey>radarr-key</ApiKey><UrlBase>radarr/</UrlBase></Config>");
  write("my-indexer/config.xml", "<Config><Port>9696</Port><ApiKey>prowlarr-key</ApiKey><InstanceName>Prowlarr</InstanceName></Config>");
  write("bazarr/config/config.yaml", "general:\n  port: 6767\n  base_url: ''\nauth:\n  apikey: bazarr-key\n");
  write("jellyseerr/settings.json", JSON.stringify({ main: { apiKey: "seerr-key" } }));
  write("broken/config.xml", "<Config><Port>8989</Port></Config>");
  // Not a valid host name: skipped (sorts before "sonarr", so it would win).
  write("Sonarr Config/config.xml", "<Config><Port>8989</Port><ApiKey>wrong-key</ApiKey><InstanceName>Sonarr</InstanceName></Config>");
  mkdirSync(join(root, "appdata", "empty"));
  process.chdir(root);
  discovery = await import("./discovery");
});

describe("auto-setup", () => {
  it("finds each app with its address and key", () => {
    expect(discovery.discovered).toEqual({
      sonarr: { url: "http://sonarr:8989", apiKey: "sonarr-key", folder: "sonarr" },
      radarr: { url: "http://radarr:7878/radarr", apiKey: "radarr-key", folder: "radarr" },
      prowlarr: { url: "http://my-indexer:9696", apiKey: "prowlarr-key", folder: "my-indexer" },
      bazarr: { url: "http://bazarr:6767", apiKey: "bazarr-key", folder: "bazarr" },
      seerr: { url: "http://jellyseerr:5055", apiKey: "seerr-key", folder: "jellyseerr" },
    });
  });

  it("lets explicit settings win field by field", () => {
    expect(discovery.resolveService("sonarr", "http://192.168.0.5:8989", undefined)).toEqual({
      url: "http://192.168.0.5:8989",
      apiKey: "sonarr-key",
    });
    expect(discovery.resolveService("sonarr", undefined, undefined)?.url).toBe("http://sonarr:8989");
  });
});
