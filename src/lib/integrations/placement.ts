import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import type { GuestWithAddresses } from "./proxmox";
import type { ServiceStatus } from "./services";

// Places services under the Proxmox guest they run on, by matching the IP in
// (or behind) the service's URL with the guest's addresses. Services whose
// host is a Docker container name (http://sonarr:8989) resolve to a Docker
// network address, not the guest's LAN IP, so they stay unplaced.

const CACHE_MS = 5 * 60_000;
const resolved = new Map<string, { at: number; ips: string[] }>();

async function hostAddresses(host: string): Promise<string[]> {
  if (isIPv4(host)) return [host];
  const cached = resolved.get(host);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ips;
  const ips = await lookup(host, { all: true, family: 4 })
    .then((results) => results.map((result) => result.address))
    .catch(() => []);
  resolved.set(host, { at: Date.now(), ips });
  return ips;
}

export function guestKey(guest: Pick<GuestWithAddresses, "node" | "vmid">): string {
  return `${guest.node}/${guest.vmid}`;
}

export async function placeServices(
  guests: GuestWithAddresses[],
  services: ServiceStatus[],
): Promise<Map<string, ServiceStatus[]>> {
  const owner = new Map<string, string>();
  for (const guest of guests) for (const ip of guest.addresses) owner.set(ip, guestKey(guest));

  const placed = new Map<string, ServiceStatus[]>();
  await Promise.all(
    services.map(async (service) => {
      const key = (await hostAddresses(service.host)).map((ip) => owner.get(ip)).find(Boolean);
      if (key) placed.set(key, [...(placed.get(key) ?? []), service]);
    }),
  );
  return placed;
}
