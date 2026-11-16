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
  // 1 qBittorrent listens on the port Gluetun forwards (or none is
  // forwarded), 0 it listens on another one. Only while both are configured.
  portForward: "qbittorrent:port-forward",
  // Docker containers by name: 1 running, 0 crashed or restarting.
  dockerUp: (name: string) => `docker:${name}:up`,
  // 1 healthy (or no health check), 0 unhealthy; only while running.
  dockerHealth: (name: string) => `docker:${name}:health`,
  // Running containers only: share of the host's CPU (all cores = 100 %),
  // and memory without page cache as a share of its limit (or host memory).
  dockerCpu: (name: string) => `docker:${name}:cpu`,
  dockerMemory: (name: string) => `docker:${name}:memory`,
};
