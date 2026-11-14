import "server-only";
import { getProxmoxOverview, isProxmoxConfigured } from "@/lib/integrations/proxmox";
import { getServiceStatuses, hasConfiguredServices } from "@/lib/integrations/services";
import { getSynologyOverview, isSynologyConfigured } from "@/lib/integrations/synology";
import { series } from "./series";

// One sample of everything that is configured, using the same adapters as
// the dashboard (and their caches).

export type Source = "synology" | "proxmox";

export type Reading = {
  series: string;
  value: number;
  kind: "cpu" | "ram" | "volume" | "up";
  label: string;
  source?: Source;
  // For "up": minutes down before alerting.
  graceMinutes?: number;
};

export type DiskReading = { key: string; label: string; status: string };

export type Snapshot = { readings: Reading[]; disks: DiskReading[]; reachable: Set<Source> };

const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : 0);

export async function collect(): Promise<Snapshot> {
  const snapshot: Snapshot = { readings: [], disks: [], reachable: new Set() };
  const add = (reading: Reading) => snapshot.readings.push(reading);

  await Promise.all([
    (async () => {
      if (!isSynologyConfigured()) return;
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
      for (const guest of result.data.guests) {
        if (guest.status !== "running") continue;
        const label = `${guest.name ?? guest.vmid} (${guest.type === "qemu" ? "VM" : "LXC"} ${guest.vmid})`;
        add({ series: series.guestCpu(guest.node, guest.vmid), value: guest.cpu * 100, kind: "cpu", label, source: "proxmox" });
        add({ series: series.guestRam(guest.node, guest.vmid), value: percent(guest.mem, guest.maxmem), kind: "ram", label, source: "proxmox" });
      }
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
