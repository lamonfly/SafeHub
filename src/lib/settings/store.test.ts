import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
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
    expect(rows.every((row) => row.value.startsWith("v2:") && !row.value.includes("plain-sonarr-key"))).toBe(true);
  });

  it("refuses a value copied into another setting's row", () => {
    store.saveSettings({ JELLYFIN_API_KEY: "secret-key" });
    const secretRow = db.select().from(schema.setting).where(eq(schema.setting.key, "JELLYFIN_API_KEY")).get()!;
    db.insert(schema.setting).values({ key: "NTFY_TOPIC", value: secretRow.value }).run();
    store.saveSettings({}); // reload from the database
    expect(store.getSetting("NTFY_TOPIC")).toBeUndefined();
    expect(store.getSetting("JELLYFIN_API_KEY")).toBe("secret-key");
    db.delete(schema.setting).where(eq(schema.setting.key, "NTFY_TOPIC")).run();
  });

  it("still reads v1 values (saved by older versions) and upgrades them to v2", () => {
    const key = createHash("sha256").update(`safehub-settings:${process.env.BETTER_AUTH_SECRET}`).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update("old-bazarr-key", "utf8"), cipher.final()]);
    const v1 = ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    db.insert(schema.setting).values({ key: "BAZARR_API_KEY", value: v1 }).run();
    store.saveSettings({}); // reload from the database
    expect(store.getSetting("BAZARR_API_KEY")).toBe("old-bazarr-key");
    const row = db.select().from(schema.setting).where(eq(schema.setting.key, "BAZARR_API_KEY")).get()!;
    expect(row.value.startsWith("v2:")).toBe(true);
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

  it("accepts whole numbers of days only", () => {
    for (const days of ["1", "7", "30", "999"]) {
      store.saveSettings({ PROXMOX_BACKUP_MAX_AGE_DAYS: days });
      expect(store.getSetting("PROXMOX_BACKUP_MAX_AGE_DAYS")).toBe(days);
    }
    for (const days of ["0", "1d", "07", "1000", "-1", "1.5"]) {
      expect(() => store.saveSettings({ PROXMOX_BACKUP_MAX_AGE_DAYS: days })).toThrow(store.SettingValidationError);
    }
    store.saveSettings({ PROXMOX_BACKUP_MAX_AGE_DAYS: null });
  });

  it("bumps the version so clients rebuild, and removes values", () => {
    const before = store.settingsVersion();
    store.saveSettings({ SONARR_URL: null, SONARR_API_KEY: null });
    expect(store.settingsVersion()).toBe(before + 1);
    expect(store.getSetting("SONARR_URL")).toBeUndefined();
  });
});
