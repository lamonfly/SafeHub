import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import type { GuestWithAddresses } from "./proxmox";
import type { ServiceStatus } from "./services";

// Places services under the Proxmox guest they run on:
// 1. the service's address is one of the guest's LAN addresses
//    (URL with an IP, or a hostname resolving to it), or
// 2. it lies in one of the guest's Docker networks. That is the case for
//    container-name URLs (http://sonarr:8989): Docker resolves them to an
//    internal address of the Docker host running the container.
// Docker reuses the same internal ranges on every host, so when an address
// fits more than one guest the service is left unplaced rather than guessed.

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

function ipToInt(ip: string): number {
  return ip.split(".").reduce((value, octet) => (value << 8) + Number(octet), 0) >>> 0;
}

function inNetwork(ip: string, cidr: string): boolean {
  const [network, prefixText] = cidr.split("/");
  const prefix = Number(prefixText);
  if (!isIPv4(network) || !(prefix >= 0 && prefix <= 32)) return false;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return ((ipToInt(ip) & mask) >>> 0) === ((ipToInt(network) & mask) >>> 0);
}

export function guestKey(guest: Pick<GuestWithAddresses, "node" | "vmid">): string {
  return `${guest.node}/${guest.vmid}`;
}

function ownerOf(ips: string[], guests: GuestWithAddresses[]): string | undefined {
  for (const ip of ips) {
    const byAddress = guests.find((guest) => guest.addresses.includes(ip));
    if (byAddress) return guestKey(byAddress);
  }
  for (const ip of ips) {
    const candidates = guests.filter((guest) => guest.dockerNetworks.some((cidr) => inNetwork(ip, cidr)));
    if (candidates.length === 1) return guestKey(candidates[0]);
  }
  return undefined;
}

export async function placeServices(
  guests: GuestWithAddresses[],
  services: ServiceStatus[],
): Promise<Map<string, ServiceStatus[]>> {
  const placed = new Map<string, ServiceStatus[]>();
  await Promise.all(
    services.map(async (service) => {
      const key = ownerOf(await hostAddresses(service.host), guests);
      if (key) placed.set(key, [...(placed.get(key) ?? []), service]);
    }),
  );
  return placed;
}
