"use server";

import { refresh } from "next/cache";
import { runGuestAction } from "@/lib/integrations/proxmox";
import {
  guestActionInputSchema,
  type GuestActionInput,
} from "@/lib/integrations/proxmox/schemas";
import { requireSession } from "@/lib/session";

export async function proxmoxGuestAction(
  input: GuestActionInput,
): Promise<{ error?: string }> {
  await requireSession();

  const parsed = guestActionInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };

  const result = await runGuestAction(parsed.data);
  if (result.status === "not-configured") return { error: "Proxmox is not configured." };
  if (result.status === "error") return { error: result.message };

  refresh();
  return {};
}
