"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { acceptCertificate } from "@/lib/integrations/tls";
import { requireSession } from "@/lib/session";

const inputSchema = z.object({
  pinId: z.string().min(1).max(300),
  fingerprint: z.string(),
});

export async function acceptCertificateAction(
  pinId: string,
  fingerprint: string,
): Promise<{ error?: string }> {
  await requireSession();

  const parsed = inputSchema.safeParse({ pinId, fingerprint });
  if (!parsed.success || !acceptCertificate(parsed.data.pinId, parsed.data.fingerprint)) {
    return { error: "Could not accept this certificate." };
  }
  refresh();
  return {};
}
