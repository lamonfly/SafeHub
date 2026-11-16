import "server-only";
import { describeFailure, type Failure } from "@/lib/alerts/failure";
import { getContainerStats, getDockerHost, isDockerConfigured, minutesUp, type DockerContainer } from "@/lib/integrations/docker";
import { backupMaxAgeDays, getProxmoxOverview, isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { getPortForwardMismatch, type PortForwardMismatch } from "@/lib/integrations/qbittorrent";
import type { IntegrationResult } from "@/lib/integrations/result";
import { getServiceStatuses, hasConfiguredServices } from "@/lib/integrations/services";
import { getSynologyOverview, isSynologyConfigured } from "@/lib/integrations/synology";
import { series } from "./series";

// One sample of everything that is configured, using the same adapters as
// the dashboard (and their caches).

export type Source = "synology" | "proxmox" | "docker";

export type Reading = {
  series: string;
  value: number;
  // "docker" / "flag": stored for history and their own rules, no generic rule.
  kind: "cpu" | "ram" | "volume" | "up" | "docker" | "flag";
  label: string;
  source?: Source;
  // For "up": minutes down before alerting.
  graceMinutes?: number;
  // For "up" at 0: what went wrong (login rejected, certificate changed ...).
  failure?: Failure;
};

// Disk or volume health as DSM reports it ("normal", "crashed" ...).
export type DiskReading = { key: string; label: string; status: string };

// Guests that have backups, with the age of the newest one. Guests that were
// never backed up are left out: often deliberate (test machines).
export type BackupReading = { key: string; label: string; ageDays: number; maxAgeDays: number };
export type BackupJobReading = { key: string; node: string; ok: boolean; status: string };

// One Docker container this round. crashed: restarting, dead, killed for
// running out of memory, or exited with an error code. Exit codes from
// being stopped (0, SIGINT 130, SIGKILL 137, SIGTERM 143) count as stopped
// on purpose.
export type ContainerReading = {
  name: string;
  state: string;
  status: string;
  exitCode?: number;
  oomKilled?: boolean;
  running: boolean;
  crashed: boolean;
  // Restarts by the restart policy within RESTART_WINDOW_MS (crash loops).
  recentRestarts?: number;
};

const CLEAN_EXIT_CODES = new Set([0, 130, 137, 143]);

export type Snapshot = {
  readings: Reading[];
  disks: DiskReading[];
  // Synology volume health (RAID degraded or crashed).
  volumes?: DiskReading[];
  reachable: Set<Source>;
  // Sources set up in the settings this round (reachable or not).
  configured?: Set<Source>;
  // Parts of this round that failed outright (a bug or a broken setup, not a
  // service being down): their alerts are left as they are.
  failed?: Set<Source | "services">;
  backups?: BackupReading[];
  backupJobs?: BackupJobReading[];
  containers?: ContainerReading[];
  // qBittorrent behind Gluetun: does it listen on the port the VPN forwards?
  // Left out when the check failed this round (nothing known).
  portForward?: { status: "not-configured" } | { status: "ok"; mismatch: PortForwardMismatch | null };
};

// Restarts per container name, kept between rounds (in memory: after a
// SafeHub restart a crash loop needs a few minutes to show again).
export const RESTART_WINDOW_MS = 15 * 60_000;
export type RestartHistory = Map<string, { id: string; count: number; times: number[] }>;

// Updates the history with this round's restart counts and returns the
// number of restarts within the window per container name. A container
// without a count this round (not inspected: started long ago) keeps its
// history. A new container ID (recreated) starts over.
export function trackRestarts(history: RestartHistory, list: DockerContainer[], now: number): Map<string, number> {
  const recent = new Map<string, number>();
  const names = new Set(list.map((container) => container.name));
  for (const name of history.keys()) if (!names.has(name)) history.delete(name);
  for (const container of list) {
    let entry = history.get(container.name);
    if (container.restartCount !== undefined) {
      if (!entry || entry.id !== container.id || container.restartCount < entry.count) {
        entry = { id: container.id, count: container.restartCount, times: [] };
      } else {
        for (let restart = entry.count; restart < container.restartCount; restart++) entry.times.push(now);
        entry.count = container.restartCount;
      }
      history.set(container.name, entry);
    }
    if (!entry) continue;
    entry.times = entry.times.filter((time) => now - time < RESTART_WINDOW_MS);
    recent.set(container.name, entry.times.length);
  }
  return recent;
}

// Readings and rule input for the containers of one Docker host.
export function containerReadings(
  list: DockerContainer[],
  recentRestarts?: Map<string, number>,
): { readings: Reading[]; containers: ContainerReading[] } {
  const readings: Reading[] = [];
  const containers = list.map((container) => {
    const running = container.state === "running";
    const crashed =
      container.state === "restarting" ||
      container.state === "dead" ||
      (container.state === "exited" &&
        (container.oomKilled === true || (container.exitCode !== undefined && !CLEAN_EXIT_CODES.has(container.exitCode))));
    if (running || crashed) {
      readings.push({ series: series.dockerUp(container.name), value: running ? 1 : 0, kind: "docker", label: container.name });
    }
    if (running) {
      const healthy = container.status.includes("(unhealthy)") ? 0 : 1;
      readings.push({ series: series.dockerHealth(container.name), value: healthy, kind: "docker", label: container.name });
    }
    const { name, state, status, exitCode, oomKilled } = container;
    // Without a count in the history (not inspected since SafeHub started),
    // a container that has been up longer than the window, or is stopped on
    // purpose, cannot have been restarted by its policy within the window.
    const quiet =
      (running && (minutesUp(status) ?? 0) * 60_000 >= RESTART_WINDOW_MS) || (!running && !crashed);
    return { name, state, status, exitCode, oomKilled, running, crashed, recentRestarts: recentRestarts?.get(name) ?? (quiet ? 0 : undefined) };
  });
  return { readings, containers };
}

const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

const failureOf = (result: IntegrationResult<unknown>) => (result.status === "error" ? describeFailure(result) : undefined);

// Each part of a round runs on its own: one that throws (a bug, a CA file
// that vanished) loses only its own readings. Logged once per part and
// message, so a lasting problem does not fill the log every minute.
const lastLogged = new Map<string, string>();

async function runPart(name: string, part: () => Promise<void>, onError: (failure: Failure) => void): Promise<void> {
  try {
    // Promise.resolve().then(): a synchronous throw becomes a rejection too.
    await Promise.resolve().then(part);
    lastLogged.delete(name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (lastLogged.get(name) !== message) {
      lastLogged.set(name, message);
      console.warn(`Metrics: ${name} failed: ${message}`);
    }
    onError({ reason: "unreachable", detail: message });
  }
}

const restartHistory: RestartHistory = new Map();

export async function collect(): Promise<Snapshot> {
  const snapshot: Snapshot = { readings: [], disks: [], volumes: [], reachable: new Set(), configured: new Set(), failed: new Set() };
  const add = (reading: Reading) => snapshot.readings.push(reading);
  // A part that threw before its "up" reading: count it as down, with the error.
  const failedUp = (source: Source, upSeries: string, label: string) => (failure: Failure) => {
    snapshot.failed?.add(source);
    snapshot.reachable.delete(source);
    if (!snapshot.readings.some((reading) => reading.series === upSeries)) {
      add({ series: upSeries, value: 0, kind: "up", label, graceMinutes: 3, failure });
    }
  };

  await Promise.allSettled([
    runPart(
      "Synology",
      async () => {
        if (!isSynologyConfigured()) return;
        snapshot.configured?.add("synology");
        const result = await getSynologyOverview();
        add({ series: series.synologyUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Synology", graceMinutes: 3, failure: failureOf(result) });
        if (result.status !== "ok") return;
        snapshot.reachable.add("synology");
        const data = result.data;
        add({ series: series.synologyCpu, value: data.cpuPercent, kind: "cpu", label: "Synology", source: "synology" });
        add({ series: series.synologyRam, value: data.memory.usedPercent, kind: "ram", label: "Synology", source: "synology" });
        for (const volume of data.volumes) {
          add({
            series: series.synologyVolume(volume.name),
            value: percent(volume.usedBytes, volume.totalBytes),
            kind: "volume",
            label: `Synology ${volume.name}`,
            source: "synology",
          });
          snapshot.volumes?.push({ key: `volume:synology:${volume.name}`, label: `Synology ${volume.name}`, status: volume.status });
        }
        for (const disk of data.disks) {
          snapshot.disks.push({ key: `disk:synology:${disk.name}`, label: `Synology ${disk.name}`, status: disk.status });
        }
      },
      failedUp("synology", series.synologyUp, "Synology"),
    ),

    runPart(
      "Proxmox",
      async () => {
        if (!isProxmoxConfigured()) return;
        snapshot.configured?.add("proxmox");
        const result = await getProxmoxOverview();
        add({ series: series.proxmoxUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Proxmox", graceMinutes: 3, failure: failureOf(result) });
        if (result.status !== "ok") return;
        snapshot.reachable.add("proxmox");
        for (const node of result.data.nodes) {
          const online = node.status === "online";
          add({ series: series.nodeUp(node.node), value: online ? 1 : 0, kind: "up", label: `Proxmox node ${node.node}`, graceMinutes: 2 });
          if (!online) continue;
          add({ series: series.nodeCpu(node.node), value: node.cpu * 100, kind: "cpu", label: `Node ${node.node}`, source: "proxmox" });
          add({ series: series.nodeRam(node.node), value: percent(node.mem, node.maxmem), kind: "ram", label: `Node ${node.node}`, source: "proxmox" });
        }
        // A storage that could not be read may hold newer backups: with partial
        // data, leave backups out so their alerts neither open nor close.
        if (result.data.backups && result.data.backups.failedStorages.length === 0) {
          const maxAgeDays = backupMaxAgeDays();
          snapshot.backups = result.data.guests.flatMap((guest) =>
            typeof guest.backupAgeMs === "number"
              ? [{
                  key: `backup:${guest.node}/${guest.vmid}`,
                  label: `${guest.name ?? guest.vmid} (${guest.type === "qemu" ? "VM" : "LXC"} ${guest.vmid})`,
                  ageDays: guest.backupAgeMs / 86_400_000,
                  maxAgeDays,
                }]
              : [],
          );
          snapshot.backupJobs = result.data.backups.jobs.map((job) => ({ key: `backup-job:${job.node}`, ...job }));
        }
        for (const guest of result.data.guests) {
          if (guest.status !== "running") continue;
          const label = `${guest.name ?? guest.vmid} (${guest.type === "qemu" ? "VM" : "LXC"} ${guest.vmid})`;
          add({ series: series.guestCpu(guest.node, guest.vmid), value: guest.cpu * 100, kind: "cpu", label, source: "proxmox" });
          add({ series: series.guestRam(guest.node, guest.vmid), value: percent(guest.mem, guest.maxmem), kind: "ram", label, source: "proxmox" });
        }
      },
      failedUp("proxmox", series.proxmoxUp, "Proxmox"),
    ),

    runPart(
      "Docker",
      async () => {
        if (!isDockerConfigured()) return;
        snapshot.configured?.add("docker");
        const result = await getDockerHost();
        add({ series: series.dockerHostUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Docker", graceMinutes: 3, failure: failureOf(result) });
        if (result.status !== "ok") return;
        snapshot.reachable.add("docker");
        const list = result.data.containers;
        const docker = containerReadings(list, trackRestarts(restartHistory, list, Date.now()));
        docker.readings.forEach(add);
        snapshot.containers = docker.containers;

        const running = list.filter((container) => container.state === "running");
        const stats = await getContainerStats(running);
        for (const container of running) {
          const usage = stats.get(container.id);
          if (usage?.cpuPercent !== undefined) {
            add({ series: series.dockerCpu(container.name), value: usage.cpuPercent, kind: "docker", label: container.name });
          }
          if (usage?.memoryPercent !== undefined) {
            add({ series: series.dockerMemory(container.name), value: usage.memoryPercent, kind: "docker", label: container.name });
          }
        }
      },
      failedUp("docker", series.dockerHostUp, "Docker"),
    ),

    runPart(
      "services",
      async () => {
        if (!hasConfiguredServices()) return;
        for (const service of await getServiceStatuses()) {
          add({
            series: series.serviceUp(service.key),
            value: service.result.status === "ok" ? 1 : 0,
            kind: "up",
            label: service.name,
            graceMinutes: 3,
            failure: failureOf(service.result),
          });
        }
      },
      () => snapshot.failed?.add("services"),
    ),

    runPart(
      "qBittorrent port check",
      async () => {
        const result = await getPortForwardMismatch();
        if (result.status === "not-configured") snapshot.portForward = { status: "not-configured" };
        if (result.status !== "ok") return;
        snapshot.portForward = { status: "ok", mismatch: result.data };
        add({ series: series.portForward, value: result.data ? 0 : 1, kind: "flag", label: "qBittorrent" });
      },
      () => {},
    ),
  ]);

  return snapshot;
}
