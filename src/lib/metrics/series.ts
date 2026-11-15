// Series names for the history tables. Values are percentages, or 1/0 for
// "up" series. Keep names stable: changing one starts a new history.

export const series = {
  synologyCpu: "synology:cpu",
  synologyRam: "synology:ram",
  synologyUp: "synology:up",
  synologyVolume: (name: string) => `synology:volume:${name}`,
  proxmoxUp: "proxmox:up",
  nodeCpu: (node: string) => `node:${node}:cpu`,
  nodeRam: (node: string) => `node:${node}:ram`,
  nodeUp: (node: string) => `node:${node}:up`,
  guestCpu: (node: string, vmid: number) => `guest:${node}/${vmid}:cpu`,
  guestRam: (node: string, vmid: number) => `guest:${node}/${vmid}:ram`,
  serviceUp: (key: string) => `service:${key}:up`,
  dockerHostUp: "docker:up",
  // Docker containers by name: 1 running, 0 crashed or restarting.
  dockerUp: (name: string) => `docker:${name}:up`,
  // 1 healthy (or no health check), 0 unhealthy; only while running.
  dockerHealth: (name: string) => `docker:${name}:health`,
};
