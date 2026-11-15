import "server-only";
import { getDockerHost, isDockerConfigured, type DockerContainer } from "@/lib/integrations/docker";
import { backupMaxAgeDays, getProxmoxOverview, isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { getServiceStatuses, hasConfiguredServices } from "@/lib/integrations/services";
import { getSynologyOverview, isSynologyConfigured } from "@/lib/integrations/synology";
import { series } from "./series";

// One sample of everything that is configured, using the same adapters as
// the dashboard (and their caches).

export type Source = "synology" | "proxmox" | "docker";

export type Reading = {
  series: string;
  value: number;
  // "docker": stored for history and the container rules, no generic rule.
  kind: "cpu" | "ram" | "volume" | "up" | "docker";
  label: string;
  source?: Source;
  // For "up": minutes down before alerting.
  graceMinutes?: number;
};

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
};

const CLEAN_EXIT_CODES = new Set([0, 130, 137, 143]);

export type Snapshot = {
  readings: Reading[];
  disks: DiskReading[];
  reachable: Set<Source>;
  // Sources set up in the settings this round (reachable or not).
  configured?: Set<Source>;
  backups?: BackupReading[];
  backupJobs?: BackupJobReading[];
  containers?: ContainerReading[];
};

// Readings and rule input for the containers of one Docker host.
export function containerReadings(list: DockerContainer[]): { readings: Reading[]; containers: ContainerReading[] } {
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
    return { name, state, status, exitCode, oomKilled, running, crashed };
  });
  return { readings, containers };
}

const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

export async function collect(): Promise<Snapshot> {
  const snapshot: Snapshot = { readings: [], disks: [], reachable: new Set(), configured: new Set() };
  const add = (reading: Reading) => snapshot.readings.push(reading);

  await Promise.all([
    (async () => {
      if (!isSynologyConfigured()) return;
      snapshot.configured?.add("synology");
      const result = await getSynologyOverview();
      add({ series: series.synologyUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Synology", graceMinutes: 3 });
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
      }
      for (const disk of data.disks) {
        snapshot.disks.push({ key: `disk:synology:${disk.name}`, label: `Synology ${disk.name}`, status: disk.status });
      }
    })(),

    (async () => {
      if (!isProxmoxConfigured()) return;
      snapshot.configured?.add("proxmox");
      const result = await getProxmoxOverview();
      add({ series: series.proxmoxUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Proxmox", graceMinutes: 3 });
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
    })(),

    (async () => {
      if (!isDockerConfigured()) return;
      snapshot.configured?.add("docker");
      const result = await getDockerHost();
      add({ series: series.dockerHostUp, value: result.status === "ok" ? 1 : 0, kind: "up", label: "Docker", graceMinutes: 3 });
      if (result.status !== "ok") return;
      snapshot.reachable.add("docker");
      const docker = containerReadings(result.data.containers);
      docker.readings.forEach(add);
      snapshot.containers = docker.containers;
    })(),

    (async () => {
      if (!hasConfiguredServices()) return;
      for (const service of await getServiceStatuses()) {
        add({
          series: series.serviceUp(service.key),
          value: service.result.status === "ok" ? 1 : 0,
          kind: "up",
          label: service.name,
          graceMinutes: 3,
        });
      }
    })(),
  ]);

  return snapshot;
}
