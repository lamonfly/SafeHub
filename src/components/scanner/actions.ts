"use server";

import { refresh } from "next/cache";
import { knownPorts } from "@/lib/net/ports";
import { discoverHosts, scanPorts } from "@/lib/scanner";
import { discoveryInputSchema, portScanInputSchema } from "@/lib/scanner/schemas";
import { requireSession } from "@/lib/session";

export type ScanState = { error?: string; message?: string };

export async function discoverAction(_state: ScanState, formData: FormData): Promise<ScanState> {
  await requireSession();

  const parsed = discoveryInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const result = await discoverHosts(parsed.data.cidr);
  if (result.status !== "ok") return { error: result.status === "error" ? result.message : "" };

  refresh();
  const { found, newHosts, durationMs } = result.data;
  const seconds = (durationMs / 1000).toFixed(1);
  return { message: `Found ${found} hosts (${newHosts} new) in ${seconds} s.` };
}

export async function scanPortsAction(_state: ScanState, formData: FormData): Promise<ScanState> {
  await requireSession();

  const parsed = portScanInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { ip, ports } = parsed.data;
  const result = await scanPorts(ip, ports);
  if (result.status !== "ok") return { error: result.status === "error" ? result.message : "" };

  refresh();
  const open = result.data.map((port) => (knownPorts[port] ? `${port} (${knownPorts[port]})` : `${port}`));
  return {
    message: open.length
      ? `${ip}: ${open.join(", ")}`
      : `${ip}: no open ports among ${ports.length} scanned.`,
  };
}
