"use server";

import { refresh } from "next/cache";
import { containerActionInputSchema, runContainerAction, type ContainerActionInput } from "@/lib/integrations/docker";
import { requireSession } from "@/lib/session";

export async function dockerContainerAction(input: ContainerActionInput): Promise<{ error?: string }> {
  await requireSession();

  const parsed = containerActionInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid request." };

  const result = await runContainerAction(parsed.data);
  if (result.status === "not-configured") return { error: "The Docker socket is not mounted." };
  if (result.status === "error") return { error: result.message };

  refresh();
  return {};
}
