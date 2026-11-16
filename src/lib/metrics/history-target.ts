// What a /history/... URL asks for, from its path segments (already decoded):
//   /history/synology
//   /history/node/<node>
//   /history/guest/<node>/<vmid>
//   /history/docker/<container name>
export type HistoryTarget =
  | { kind: "synology" }
  | { kind: "node"; node: string }
  | { kind: "guest"; node: string; vmid: number }
  | { kind: "docker"; name: string };

// Proxmox node names are host names; Docker names follow Docker's own rule.
const NODE_NAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function parseHistoryTarget(segments: string[]): HistoryTarget | null {
  const [kind, first, second] = segments;
  if (kind === "synology" && segments.length === 1) return { kind };
  if (kind === "node" && segments.length === 2 && NODE_NAME.test(first)) return { kind, node: first };
  if (kind === "guest" && segments.length === 3 && NODE_NAME.test(first) && /^\d{1,9}$/.test(second)) {
    return { kind, node: first, vmid: Number(second) };
  }
  if (kind === "docker" && segments.length === 2 && CONTAINER_NAME.test(first)) return { kind, name: first };
  return null;
}

export function historyPath(target: HistoryTarget): string {
  switch (target.kind) {
    case "synology":
      return "/history/synology";
    case "node":
      return `/history/node/${encodeURIComponent(target.node)}`;
    case "guest":
      return `/history/guest/${encodeURIComponent(target.node)}/${target.vmid}`;
    case "docker":
      return `/history/docker/${encodeURIComponent(target.name)}`;
  }
}
