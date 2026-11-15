"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { errorResult } from "@/lib/integrations/result";
import { createProxmoxToken } from "@/lib/integrations/proxmox/connect";
import { sendTestNotification } from "@/lib/notifications/ntfy";
import { settingGroups } from "@/lib/settings/definitions";
import { saveSettings, settingSource, SettingValidationError } from "@/lib/settings/store";
import { requireSession } from "@/lib/session";

export type SettingsState = {
  error?: string;
  message?: string;
  // Proxmox wizard: the pinned certificate changed (e.g. after a reinstall).
  certificateChanged?: { pinId: string; fingerprint: string };
};

function findGroup(formData: FormData) {
  return settingGroups.find((group) => group.id === formData.get("group"));
}

// Saves one group. Empty secret fields keep the saved value; empty text
// fields remove it; an unticked checkbox removes the flag.
export async function saveGroupAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const group = findGroup(formData);
  if (!group) return { error: "Unknown section." };

  const changes: Record<string, string | null> = {};
  for (const field of group.fields) {
    if (field.type === "flag") {
      changes[field.key] = formData.get(field.key) === "on" ? "true" : null;
      continue;
    }
    const value = String(formData.get(field.key) ?? "").trim();
    if (field.type === "secret" && value === "") continue;
    changes[field.key] = value === "" ? null : value;
  }

  try {
    saveSettings(changes);
  } catch (error) {
    if (error instanceof SettingValidationError) return { error: error.message };
    throw error;
  }
  refresh();
  return { message: "Saved." };
}

export async function clearGroupAction(groupId: string): Promise<SettingsState> {
  await requireSession();
  const group = settingGroups.find((candidate) => candidate.id === groupId);
  if (!group) return { error: "Unknown section." };
  saveSettings(Object.fromEntries(group.fields.map((field) => [field.key, null])));
  refresh();
  return { message: "Removed." };
}

const connectSchema = z.object({
  url: z.url("Enter the Proxmox address, e.g. https://192.168.1.10:8006."),
  username: z.string().trim().regex(/^[^@\s]+@[^@\s]+$/, "Username must look like root@pam."),
  password: z.string().max(1000),
  allowControl: z.literal("on").optional(),
});

// Proxmox wizard: creates a dedicated user + token with an admin login and
// saves the token. The password is used once and never stored.
export async function connectProxmoxAction(_state: SettingsState, formData: FormData): Promise<SettingsState> {
  await requireSession();
  const parsed = connectSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const locked = ["PROXMOX_URL", "PROXMOX_TOKEN_ID", "PROXMOX_TOKEN_SECRET"].filter(
    (key) => settingSource(key) === "env",
  );
  if (locked.length > 0) {
    return { error: `Remove ${locked.join(", ")} from compose.yaml / .env first; those settings win.` };
  }

  try {
    const token = await createProxmoxToken({
      url: parsed.data.url,
      username: parsed.data.username,
      password: parsed.data.password,
      allowControl: parsed.data.allowControl === "on",
    });
    saveSettings({
      PROXMOX_URL: parsed.data.url,
      PROXMOX_TOKEN_ID: token.tokenId,
      PROXMOX_TOKEN_SECRET: token.secret,
    });
  } catch (error) {
    const result = errorResult(error);
    return { error: result.message, certificateChanged: result.certificateChanged };
  }
  refresh();
  return { message: "Connected. SafeHub now uses its own Proxmox token; the password was not saved." };
}

// Settings > Notifications: sends a test push with the saved settings.
export async function testNotificationAction(): Promise<SettingsState> {
  await requireSession();
  try {
    await sendTestNotification();
  } catch (error) {
    return { error: errorResult(error).message };
  }
  return { message: "Sent. Check the ntfy app." };
}
