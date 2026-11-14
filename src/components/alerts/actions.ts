"use server";

import { refresh } from "next/cache";
import { markAllRead } from "@/lib/alerts/store";
import { requireSession } from "@/lib/session";

export async function markAllReadAction(): Promise<void> {
  await requireSession();
  markAllRead();
  refresh();
}
