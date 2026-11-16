"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { errorResult } from "@/lib/integrations/result";
import { createProxmoxToken } from "@/lib/integrations/proxmox/connect";
import { sendTestNotification } from "@/lib/notifications/ntfy";
import { settingGroups } from "@/lib/settings/definitions";
import { saveSettings, settingSource, SettingValidationError } from "@/lib/settings/store";
import { requireSession } from "@/lib/session";
import { httpUrl } from "@/lib/url";

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
    const raw = String(formData.get(field.key) ?? "");
    if (field.type === "secret") {
      // Empty or only spaces: keep the saved secret (a stray space must not
      // replace it). Otherwise kept exactly as typed: spaces can be part of
      // a password.
      if (raw.trim() === "") continue;
      changes[field.key] = raw;
      continue;
    }
    const value = raw.trim();
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
  url: httpUrl,
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

  let guestAgentAddresses: boolean;
  let oldTokensRemoved = true;
  // Set once the token exists on Proxmox but is not saved yet.
  let unsavedToken: Awaited<ReturnType<typeof createProxmoxToken>> | undefined;
  try {
    const token = await createProxmoxToken({
      url: parsed.data.url,
      username: parsed.data.username,
      password: parsed.data.password,
      allowControl: parsed.data.allowControl === "on",
    });
    unsavedToken = token;
    saveSettings({
      PROXMOX_URL: parsed.data.url,
      PROXMOX_TOKEN_ID: token.tokenId,
      PROXMOX_TOKEN_SECRET: token.secret,
    });
    unsavedToken = undefined;
    guestAgentAddresses = token.guestAgentAddresses;
    // Only now, with the new token saved, the old one can go.
    await token.removeOldTokens().catch((error: Error) => {
      oldTokensRemoved = false;
      console.warn(`Proxmox wizard: could not remove old tokens of safehub@pve: ${error.message}`);
    });
  } catch (error) {
    // Saving failed: the new token's secret is lost, so remove the token
    // instead of leaving an unused one on Proxmox. Never log the secret.
    if (unsavedToken) {
      const tokenId = unsavedToken.tokenId;
      await unsavedToken.removeNewToken().catch((removeError: Error) => {
        console.warn(`Proxmox wizard: could not remove the unsaved token ${tokenId}: ${removeError.message}`);
      });
    }
    const result = errorResult(error);
    return { error: result.message, certificateChanged: result.certificateChanged };
  }
  refresh();
  const notes = [
    "Connected. SafeHub now uses its own Proxmox token; the password was not saved.",
    guestAgentAddresses
      ? ""
      : "This Proxmox version has no read-only guest agent right (VM.GuestAgent.Audit, Proxmox VE 9), so VM addresses from the guest agent are not shown. Container (LXC) addresses still work.",
    oldTokensRemoved ? "" : "Old safehub@pve tokens could not be removed; delete them in Proxmox.",
  ];
  return { message: notes.filter(Boolean).join(" ") };
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
