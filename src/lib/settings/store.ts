import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { setting } from "@/db/schema";
import { env } from "@/lib/env";
import { settingFields, type FieldType } from "./definitions";

// Effective integration settings: compose.yaml / .env first, then values
// saved on the /settings page. Saved values are encrypted with a key derived
// from the login secret, so a copy of the database alone does not reveal them.
// If the login secret changes, saved values can no longer be read and must be
// entered again.

const encryptionKey = createHash("sha256")
  .update(`safehub-settings:${env.BETTER_AUTH_SECRET}`)
  .digest();

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((part) => (typeof part === "string" ? part : part.toString("base64"))).join(":");
}

function decrypt(stored: string): string | undefined {
  try {
    const [version, iv, tag, data] = stored.split(":");
    if (version !== "v1") return undefined;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

// Saved values, decrypted once and kept in memory (single process).
let saved: Map<string, string> | undefined;
let version = 0;

function savedValues(): Map<string, string> {
  if (!saved) {
    saved = new Map();
    for (const row of db.select().from(setting).all()) {
      const value = decrypt(row.value);
      if (value === undefined) {
        console.warn(`Settings: cannot decrypt ${row.key} (login secret changed?); enter it again.`);
      } else {
        saved.set(row.key, value);
      }
    }
  }
  return saved;
}

function envValue(key: string): string | undefined {
  const value = (env as Record<string, unknown>)[key];
  if (typeof value === "string") return value;
  if (value === true) return "true"; // flags default to false: only true counts as set
  return undefined;
}

// Changes whenever settings are saved; adapters rebuild their clients then.
export function settingsVersion(): number {
  return version;
}

export function getSetting(key: string): string | undefined {
  return envValue(key) ?? savedValues().get(key);
}

export function getFlag(key: string): boolean {
  return getSetting(key) === "true";
}

export function settingSource(key: string): "env" | "saved" | undefined {
  if (envValue(key) !== undefined) return "env";
  return savedValues().has(key) ? "saved" : undefined;
}

const validators: Record<FieldType, z.ZodType<string>> = {
  url: z.url().max(500),
  text: z.string().trim().min(1).max(500),
  secret: z.string().min(1).max(2000),
  flag: z.enum(["true"]),
};

export class SettingValidationError extends Error {}

// Applies changes for the given keys: a string saves it, null removes it.
// Keys set in compose.yaml / .env are never touched.
export function saveSettings(changes: Record<string, string | null>): void {
  const entries = Object.entries(changes).filter(([key]) => envValue(key) === undefined);
  for (const [key, value] of entries) {
    const field = settingFields.get(key);
    if (!field) throw new SettingValidationError(`Unknown setting ${key}.`);
    if (value !== null && !validators[field.type].safeParse(value).success) {
      throw new SettingValidationError(`${field.label}: invalid value.`);
    }
  }

  db.transaction((tx) => {
    for (const [key, value] of entries) {
      if (value === null) {
        tx.delete(setting).where(eq(setting.key, key)).run();
      } else {
        const stored = encrypt(value);
        tx.insert(setting)
          .values({ key, value: stored })
          .onConflictDoUpdate({ target: setting.key, set: { value: stored, updatedAt: new Date() } })
          .run();
      }
    }
  });
  saved = undefined;
  version++;
}
