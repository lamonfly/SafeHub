import "server-only";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const macPattern = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;

function normalizeMac(mac: string): string | null {
  const normalized = mac.toLowerCase().replace(/-/g, ":");
  // Skip incomplete, broadcast and multicast entries.
  if (normalized === "00:00:00:00:00:00" || normalized === "ff:ff:ff:ff:ff:ff") return null;
  if (parseInt(normalized.slice(0, 2), 16) & 1) return null;
  return normalized;
}

function parseLines(lines: string[]): Map<string, string> {
  const table = new Map<string, string>();
  for (const line of lines) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    const mac = line.match(macPattern)?.[0];
    const normalized = mac && normalizeMac(mac);
    if (ip && normalized) table.set(ip, normalized);
  }
  return table;
}

// IP -> MAC from the OS neighbor cache. Only covers hosts on the same L2
// network that the server talked to recently (the scan itself fills it).
// Linux reads /proc/net/arp; other systems run `arp -a`.
export async function readArpTable(): Promise<Map<string, string>> {
  try {
    if (process.platform === "linux") {
      const content = await readFile("/proc/net/arp", "utf8");
      return parseLines(content.split("\n").slice(1));
    }
    const { stdout } = await execFileAsync("arp", ["-a"], { timeout: 5_000 });
    return parseLines(stdout.split("\n"));
  } catch {
    return new Map();
  }
}
