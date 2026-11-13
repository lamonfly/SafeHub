"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { errorResult } from "@/lib/integrations/result";
import { requireSession } from "@/lib/session";
import { addDevice, deleteDevice, getDevice, sendMagicPacket } from "@/lib/wol";
import { wolDeviceInputSchema } from "@/lib/wol/schemas";

export type ActionState = { error?: string; message?: string };

const idSchema = z.uuid();

export async function wakeDeviceAction(id: string): Promise<ActionState> {
  await requireSession();

  const parsed = idSchema.safeParse(id);
  const device = parsed.success ? await getDevice(parsed.data) : undefined;
  if (!device) return { error: "Device not found." };

  try {
    await sendMagicPacket(device);
  } catch (error) {
    return { error: errorResult(error).message };
  }
  return { message: "Magic packet sent." };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) => (value as { code?: string } | undefined)?.code;
  const cause = (error as { cause?: unknown } | undefined)?.cause;
  return code(error) === "SQLITE_CONSTRAINT_UNIQUE" || code(cause) === "SQLITE_CONSTRAINT_UNIQUE";
}

export async function addDeviceAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireSession();

  const parsed = wolDeviceInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    await addDevice(parsed.data);
  } catch (error) {
    if (isUniqueViolation(error)) return { error: "A device with this MAC already exists." };
    throw error;
  }
  refresh();
  return { message: `Added ${parsed.data.name}.` };
}

export async function deleteDeviceAction(id: string): Promise<ActionState> {
  await requireSession();

  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return { error: "Device not found." };

  await deleteDevice(parsed.data);
  refresh();
  return {};
}
