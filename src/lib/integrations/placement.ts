import "server-only";
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import type { DockerContainer, DockerHost } from "./docker";
import type { GuestWithAddresses } from "./proxmox";

// Places services under the Proxmox guest they run on:
// 1. the service's address is one of the guest's LAN addresses
//    (URL with an IP, or a hostname resolving to it), or
// 2. it lies in one of the guest's Docker networks. That is the case for
//    container-name URLs (http://sonarr:8989): Docker resolves them to an
//    internal address of the Docker host running the container.
// 3. its host name is a container (or compose service) name on the Docker
//    host SafeHub runs on, once that host is placed. This works without the
//    guest's network details (VM without guest agent rights).
// Docker reuses the same internal ranges on every host, so when an address
// fits more than one guest the service is left unplaced rather than guessed.

// Host names are resolved with a short timeout (a slow DNS server must not
// hold up the dashboard), one lookup per host at a time, and cached for a
// minute (failures for 10 s). A lookup that times out keeps running and
// fills the cache for the next render.
const RESOLVED_MS = 60_000;
const FAILED_MS = 10_000;
const LOOKUP_TIMEOUT_MS = 500;

export type HostResolver = (host: string) => Promise<string[]>;

const systemLookup = (host: string) =>
  lookup(host, { all: true, family: 4 }).then((results) => results.map((result) => result.address));

export function createHostResolver(
  lookupHost: (host: string) => Promise<string[]> = systemLookup,
  timeoutMs = LOOKUP_TIMEOUT_MS,
): HostResolver {
  const cache = new Map<string, { at: number; ips: string[] }>();
  const inFlight = new Map<string, Promise<string[]>>();

  return async (host) => {
    if (isIPv4(host)) return [host];
    const cached = cache.get(host);
    if (cached && Date.now() - cached.at < (cached.ips.length > 0 ? RESOLVED_MS : FAILED_MS)) return cached.ips;

    let pending = inFlight.get(host);
    if (!pending) {
      pending = lookupHost(host)
        .catch(() => [])
        .then((ips) => {
          cache.set(host, { at: Date.now(), ips });
          inFlight.delete(host);
          return ips;
        });
      inFlight.set(host, pending);
    }
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<string[]>((resolve) => {
      timer = setTimeout(() => resolve(cached?.ips ?? []), timeoutMs);
    });
    const ips = await Promise.race([pending, timedOut]);
    clearTimeout(timer);
    return ips;
  };
}

const resolveHost = createHostResolver();

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

// The Docker host SafeHub can see, with the guest it was placed on.
export type PlacedDockerHost = { guest: string; containers: Pick<DockerContainer, "name" | "composeService">[] };

function runsInContainer(host: string, docker: PlacedDockerHost): boolean {
  if (isIPv4(host)) return false;
  const name = host.toLowerCase();
  return docker.containers.some(
    (container) => container.name.toLowerCase() === name || container.composeService?.toLowerCase() === name,
  );
}

function ownerOf(
  host: string,
  ips: string[],
  guests: GuestWithAddresses[],
  docker: PlacedDockerHost | undefined,
): string | undefined {
  for (const ip of ips) {
    const byAddress = guests.find((guest) => guest.addresses.includes(ip));
    if (byAddress) return guestKey(byAddress);
  }
  if (docker && runsInContainer(host, docker)) return docker.guest;
  for (const ip of ips) {
    const candidates = guests.filter((guest) => guest.dockerNetworks.some((cidr) => inNetwork(ip, cidr)));
    if (candidates.length === 1) return guestKey(candidates[0]);
  }
  return undefined;
}

// Needs only each service's host, not its status, so the guest tree can be
// laid out before the service tiles have their data.
export async function placeServices<Service extends { host: string }>(
  guests: GuestWithAddresses[],
  services: Service[],
  docker?: PlacedDockerHost,
  resolve: HostResolver = resolveHost,
): Promise<Map<string, Service[]>> {
  const placed = new Map<string, Service[]>();
  await Promise.all(
    services.map(async (service) => {
      const key = ownerOf(service.host, await resolve(service.host), guests, docker);
      if (key) placed.set(key, [...(placed.get(key) ?? []), service]);
    }),
  );
  return placed;
}

// Finds the guest a Docker host runs in, trying in order:
// 1. Docker's host name equal to the guest's name (LXC host names usually are);
// 2. the one guest whose Docker interfaces carry all of the host's network
//    gateways (the set of ranges tells hosts apart better than one range);
// 3. the guest whose LAN address SafeHub was opened at (SafeHub runs on this
//    Docker host, so that address is the host's).
export function placeDockerHost(
  guests: GuestWithAddresses[],
  host: Pick<DockerHost, "name" | "gateways">,
  openedAt?: string,
): string | undefined {
  const byName = guests.filter((guest) => guest.name?.toLowerCase() === host.name.toLowerCase());
  if (byName.length === 1) return guestKey(byName[0]);
  if (host.gateways.length > 0) {
    const byGateways = guests.filter((guest) => {
      const own = new Set(guest.dockerNetworks.map((cidr) => cidr.split("/")[0]));
      return host.gateways.every((gateway) => own.has(gateway));
    });
    if (byGateways.length === 1) return guestKey(byGateways[0]);
  }
  const byAddress = openedAt ? guests.find((guest) => guest.addresses.includes(openedAt)) : undefined;
  return byAddress ? guestKey(byAddress) : undefined;
}
