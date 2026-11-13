import "server-only";
import { Resolver } from "node:dns/promises";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { networkHost, scanRun, type NetworkHost, type ScanRun } from "@/db/schema";
import { errorResult, type IntegrationResult } from "@/lib/integrations/result";
import { readNeighbors, type Neighbor } from "@/lib/net/arp";
import { connectTcp, mapLimit } from "@/lib/net/probe";
import { discoveryPorts } from "@/lib/net/ports";
import { cidrContains, hostsInCidr, type Cidr } from "@/lib/net/subnet";
import { lookupVendor } from "@/lib/net/vendor";

const DISCOVERY_TIMEOUT_MS = 600;
const DISCOVERY_CONCURRENCY = 64; // hosts at once; each tries all discovery ports
const PORT_TIMEOUT_MS = 800;
const PORT_CONCURRENCY = 128;
// Linux needs about 5 s (DELAY) plus 3 one-second probes to confirm or fail
// a neighbor entry the scan just touched.
const NEIGHBOR_SETTLE_MS = 9_000;

// One scan at a time per server; scans are bursty and share the socket pool.
let scanRunning = false;

async function withScanLock<T>(fn: () => Promise<T>): Promise<IntegrationResult<T>> {
  if (scanRunning) return { status: "error", message: "A scan is already running." };
  scanRunning = true;
  try {
    return { status: "ok", data: await fn() };
  } catch (error) {
    return errorResult(error);
  } finally {
    scanRunning = false;
  }
}

async function isHostUp(ip: string): Promise<boolean> {
  const states = await Promise.all(
    discoveryPorts.map((port) => connectTcp(ip, port, DISCOVERY_TIMEOUT_MS)),
  );
  return states.some((state) => state !== "filtered");
}

const resolver = new Resolver({ timeout: 1_000, tries: 1 });

async function reverseLookup(ip: string): Promise<string | null> {
  try {
    const [name] = await resolver.reverse(ip);
    return name ?? null;
  } catch {
    return null;
  }
}

// Reads the neighbor table, waiting while entries for hosts that did not
// answer TCP are still being checked by the kernel. Without the wait, a host
// that just went offline still looks present via its old entry.
async function readSettledNeighbors(cidr: Cidr, tcpAlive: Set<string>): Promise<Map<string, Neighbor>> {
  const deadline = Date.now() + NEIGHBOR_SETTLE_MS;
  let table = await readNeighbors();
  const unsettled = () =>
    [...table].some(
      ([ip, neighbor]) => neighbor.state === "pending" && !tcpAlive.has(ip) && cidrContains(cidr, ip),
    );
  while (unsettled() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    table = await readNeighbors();
  }
  return table;
}

export type DiscoveryResult = { found: number; newHosts: number; durationMs: number };

// Finds live hosts with TCP probes, then adds hosts that only answered ARP
// (firewalled phones etc. still show up in the neighbor cache).
export async function discoverHosts(cidr: Cidr): Promise<IntegrationResult<DiscoveryResult>> {
  return withScanLock(async () => {
    const startedAt = new Date();
    const cidrText = `${cidr.network}/${cidr.prefix}`;
    const [run] = await db
      .insert(scanRun)
      .values({ cidr: cidrText, startedAt })
      .returning({ id: scanRun.id });

    const addresses = hostsInCidr(cidr);
    const up = await mapLimit(addresses, DISCOVERY_CONCURRENCY, isHostUp);
    const alive = new Set(addresses.filter((_, i) => up[i]));
    const neighbors = await readSettledNeighbors(cidr, alive);
    // Hosts that only answered ARP count when the entry is confirmed. Sources
    // without states (Windows, /proc/net/arp) are taken as they are.
    for (const [ip, neighbor] of neighbors) {
      const answered = neighbor.state === "confirmed" || neighbor.state === "unknown";
      if (answered && cidrContains(cidr, ip)) alive.add(ip);
    }

    const hosts = await mapLimit([...alive], 16, async (ip) => {
      const mac = neighbors.get(ip)?.mac ?? null;
      return {
        id: mac ?? `ip:${ip}`,
        ip,
        mac,
        vendor: mac ? await lookupVendor(mac) : null,
        hostname: await reverseLookup(ip),
        lastSeenAt: startedAt,
      };
    });

    let newHosts = 0;
    for (const host of hosts) {
      const [row] = await db
        .insert(networkHost)
        .values({ ...host, firstSeenAt: startedAt })
        .onConflictDoUpdate({
          target: networkHost.id,
          set: {
            ip: host.ip,
            vendor: host.vendor,
            // Keep the old name if the lookup failed this time.
            hostname: sql`coalesce(${host.hostname}, ${networkHost.hostname})`,
            lastSeenAt: host.lastSeenAt,
          },
        })
        .returning({ firstSeenAt: networkHost.firstSeenAt });
      if (row.firstSeenAt.getTime() === startedAt.getTime()) newHosts++;
      // MAC now known: drop the IP-only row from earlier scans.
      if (host.mac) await db.delete(networkHost).where(eq(networkHost.id, `ip:${host.ip}`));
    }

    await db
      .update(scanRun)
      .set({ finishedAt: new Date(), hostsFound: hosts.length })
      .where(eq(scanRun.id, run.id));

    return { found: hosts.length, newHosts, durationMs: Date.now() - startedAt.getTime() };
  });
}

// TCP connect scan. Saves the result on the host row if the IP is known.
export async function scanPorts(ip: string, ports: number[]): Promise<IntegrationResult<number[]>> {
  return withScanLock(async () => {
    const states = await mapLimit(ports, PORT_CONCURRENCY, (port) =>
      connectTcp(ip, port, PORT_TIMEOUT_MS),
    );
    const open = ports.filter((_, i) => states[i] === "open");
    // Old rows can share the IP (DHCP reuse); update only the latest one.
    const [latest] = await db
      .select({ id: networkHost.id })
      .from(networkHost)
      .where(eq(networkHost.ip, ip))
      .orderBy(desc(networkHost.lastSeenAt))
      .limit(1);
    if (latest) {
      await db
        .update(networkHost)
        .set({ openPorts: open, portsScannedAt: new Date() })
        .where(eq(networkHost.id, latest.id));
    }
    return open;
  });
}

export type HostView = NetworkHost & { seenInLastScan: boolean; isNew: boolean };

export async function getScannerOverview(): Promise<{
  lastRun: ScanRun | undefined;
  hosts: HostView[];
}> {
  const runs = await db.select().from(scanRun).orderBy(desc(scanRun.id)).limit(2);
  const lastRun = runs[0];
  // On the very first scan everything is new, which is not useful to flag.
  const hasEarlierRun = runs.length > 1;
  const rows = await db.select().from(networkHost);

  const ipValue = (ip: string) => ip.split(".").reduce((v, o) => v * 256 + Number(o), 0);
  const hosts = rows
    .map((host) => ({
      ...host,
      seenInLastScan: !!lastRun && host.lastSeenAt >= lastRun.startedAt,
      isNew: hasEarlierRun && !!lastRun && host.firstSeenAt >= lastRun.startedAt,
    }))
    .sort((a, b) => ipValue(a.ip) - ipValue(b.ip));

  return { lastRun, hosts };
}
