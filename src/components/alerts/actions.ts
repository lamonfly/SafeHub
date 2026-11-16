"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { markAllRead, muteAlert, pauseNotifications } from "@/lib/alerts/store";
import { requireSession } from "@/lib/session";

export async function markAllReadAction(): Promise<void> {
  await requireSession();
  markAllRead();
  refresh();
}

const muteInputSchema = z.object({
  id: z.number().int().positive(),
  duration: z.enum(["1h", "8h", "24h", "resolved", "off"]),
});

// Mutes (or unmutes) the notifications of one open alert.
export async function muteAlertAction(input: z.input<typeof muteInputSchema>): Promise<{ error?: string }> {
  await requireSession();
  const parsed = muteInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  const changed = muteAlert(parsed.data.id, parsed.data.duration);
  refresh();
  return changed ? {} : { error: "This alert is already resolved." };
}

const pauseInputSchema = z.object({ duration: z.enum(["1h", "4h", "24h", "off"]) });

// Pauses all notifications for planned maintenance, or ends the pause.
export async function pauseNotificationsAction(input: z.input<typeof pauseInputSchema>): Promise<{ error?: string }> {
  await requireSession();
  const parsed = pauseInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };
  pauseNotifications(parsed.data.duration);
  refresh();
  return {};
}
