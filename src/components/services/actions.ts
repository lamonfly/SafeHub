"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { decideSeerrRequest, requestDecisionSchema, type RequestDecision } from "@/lib/integrations/seerr";
import { runServiceAction } from "@/lib/integrations/services";
import { requireSession } from "@/lib/session";

const actionInputSchema = z.object({
  serviceKey: z.string().regex(/^[a-z]+$/),
  actionId: z.string().regex(/^[a-z-]+$/),
});

// Scan / refresh / search buttons on the service tiles.
export async function serviceAction(serviceKey: string, actionId: string): Promise<{ error?: string; message?: string }> {
  await requireSession();
  const parsed = actionInputSchema.safeParse({ serviceKey, actionId });
  if (!parsed.success) return { error: "Invalid request." };

  const result = await runServiceAction(parsed.data.serviceKey, parsed.data.actionId);
  if (result.status === "not-configured") return { error: "This service is not configured." };
  if (result.status === "error") return { error: result.message };

  refresh();
  return { message: result.data || "Done." };
}

// Approve / Decline on the Seerr tile.
export async function seerrRequestAction(input: RequestDecision): Promise<{ error?: string }> {
  await requireSession();
  const parsed = requestDecisionSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };

  const result = await decideSeerrRequest(parsed.data);
  if (result.status === "not-configured") return { error: "Seerr is not configured." };
  if (result.status === "error") return { error: result.message };

  refresh();
  return {};
}
