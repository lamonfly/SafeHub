import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

// confirmed: the host answered recently (REACHABLE, PERMANENT)
// pending:   the kernel is still checking it (DELAY, PROBE)
// stale:     old entry, the host may be gone (STALE)
// unknown:   the source has no state (Windows `arp -a`, /proc/net/arp)
export type NeighborState = "confirmed" | "pending" | "stale" | "unknown";
export type Neighbor = { mac: string; state: NeighborState };

const macPattern = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;

function normalizeMac(mac: string): string | null {
  const normalized = mac.toLowerCase().replace(/-/g, ":");
  // Skip incomplete, broadcast and multicast entries.
  if (normalized === "00:00:00:00:00:00" || normalized === "ff:ff:ff:ff:ff:ff") return null;
  if (parseInt(normalized.slice(0, 2), 16) & 1) return null;
  return normalized;
}

function parseLines(lines: string[]): Map<string, Neighbor> {
  const table = new Map<string, Neighbor>();
  for (const line of lines) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    const mac = line.match(macPattern)?.[0];
    const normalized = mac && normalizeMac(mac);
    if (ip && normalized) table.set(ip, { mac: normalized, state: "unknown" });
  }
  return table;
}

const ipNeighSchema = z.array(
  z.object({
    dst: z.string(),
    lladdr: z.string().optional(),
    state: z.array(z.string()).default([]),
  }),
);

function neighborState(states: string[]): NeighborState | null {
  if (states.includes("REACHABLE") || states.includes("PERMANENT") || states.includes("NOARP")) {
    return "confirmed";
  }
  if (states.includes("DELAY") || states.includes("PROBE")) return "pending";
  if (states.includes("STALE")) return "stale";
  return null; // FAILED, INCOMPLETE, NONE
}

async function readIpNeigh(): Promise<Map<string, Neighbor>> {
  const { stdout } = await execFileAsync("ip", ["-j", "-4", "neigh", "show"], { timeout: 5_000 });
  const table = new Map<string, Neighbor>();
  for (const entry of ipNeighSchema.parse(JSON.parse(stdout || "[]"))) {
    const mac = entry.lladdr && normalizeMac(entry.lladdr);
    const state = neighborState(entry.state);
    if (mac && state) table.set(entry.dst, { mac, state });
  }
  return table;
}

// IP -> MAC from the OS neighbor cache. Only covers hosts on the same L2
// network that the server talked to recently (the scan itself fills it).
// Linux: `ip neigh` (with entry states), else /proc/net/arp; other systems
// run `arp -a`. Both fallbacks have no state.
export async function readNeighbors(): Promise<Map<string, Neighbor>> {
  try {
    if (process.platform === "linux") {
      try {
        return await readIpNeigh();
      } catch {
        const content = await readFile("/proc/net/arp", "utf8");
        return parseLines(content.split("\n").slice(1));
      }
    }
    const { stdout } = await execFileAsync("arp", ["-a"], { timeout: 5_000 });
    return parseLines(stdout.split("\n"));
  } catch {
    return new Map();
  }
}
