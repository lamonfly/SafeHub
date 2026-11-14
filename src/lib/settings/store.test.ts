import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";

let store: typeof import("./store");
let db: Awaited<ReturnType<typeof migratedDb>>;
let schema: typeof import("@/db/schema");

beforeAll(async () => {
  // A value from compose.yaml / .env, which must win and stay untouched.
  process.env.RADARR_URL = "http://env-radarr:7878";
  db = await migratedDb();
  store = await import("./store");
  schema = await import("@/db/schema");
});

describe("settings store", () => {
  it("saves values encrypted and reads them back", () => {
    store.saveSettings({ SONARR_URL: "http://sonarr:8989", SONARR_API_KEY: "plain-sonarr-key" });
    expect(store.getSetting("SONARR_API_KEY")).toBe("plain-sonarr-key");
    expect(store.settingSource("SONARR_URL")).toBe("saved");
    const rows = db.select().from(schema.setting).all();
    expect(rows.every((row) => row.value.startsWith("v1:") && !row.value.includes("plain-sonarr-key"))).toBe(true);
  });

  it("lets compose.yaml / .env win and never overwrites it", () => {
    store.saveSettings({ RADARR_URL: "http://other:1" });
    expect(store.getSetting("RADARR_URL")).toBe("http://env-radarr:7878");
    expect(store.settingSource("RADARR_URL")).toBe("env");
  });

  it("rejects invalid values and unknown keys", () => {
    expect(() => store.saveSettings({ JELLYFIN_URL: "not a url" })).toThrow(store.SettingValidationError);
    expect(() => store.saveSettings({ NOT_A_SETTING: "x" })).toThrow(store.SettingValidationError);
  });

  it("bumps the version so clients rebuild, and removes values", () => {
    const before = store.settingsVersion();
    store.saveSettings({ SONARR_URL: null, SONARR_API_KEY: null });
    expect(store.settingsVersion()).toBe(before + 1);
    expect(store.getSetting("SONARR_URL")).toBeUndefined();
  });
});
