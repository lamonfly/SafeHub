import "server-only";
import { isIPv4 } from "node:net";
import { z } from "zod";
import type { HttpClient } from "../http";
import { responseSchema, type ProxmoxGuest } from "./schemas";

// Network details of running guests, used to place services under the guest
// they run on.
//   LXC: /lxc/{vmid}/interfaces (needs only read access)
//   VM:  the QEMU guest agent; without the agent the VM has no addresses here
// Addresses rarely change, so each guest is asked at most every 5 minutes.

const CACHE_MS = 5 * 60_000;

export type GuestNetworks = {
  // How the LAN reaches the guest; shown on the dashboard.
  addresses: string[];
  // Docker networks inside the guest (CIDR, e.g. "172.20.0.1/16"). Services
  // reached by container name resolve to addresses in these.
  dockerNetworks: string[];
};

const dockerInterface = /^(docker\d*|br-)/;
// Other virtual interfaces say nothing about where a service runs.
const ignoredInterface = /^(lo|veth|virbr|cni|flannel|tailscale|zt)/;

const lxcInterfacesSchema = z.array(z.object({ name: z.string(), inet: z.string().optional() }));

const agentInterfacesSchema = z.object({
  result: z.array(
    z.object({
      name: z.string(),
      "ip-addresses": z
        .array(
          z.object({
            "ip-address": z.string(),
            "ip-address-type": z.string(),
            prefix: z.number().optional(),
          }),
        )
        .default([]),
    }),
  ),
});

type Nic = { name: string; ip: string; prefix?: number };

function classify(nics: Nic[]): GuestNetworks {
  const result: GuestNetworks = { addresses: [], dockerNetworks: [] };
  for (const { name, ip, prefix } of nics) {
    if (!isIPv4(ip) || ip.startsWith("127.") || ignoredInterface.test(name)) continue;
    if (dockerInterface.test(name)) {
      if (prefix !== undefined) result.dockerNetworks.push(`${ip}/${prefix}`);
    } else {
      result.addresses.push(ip);
    }
  }
  return result;
}

async function fetchNetworks(client: HttpClient, guest: ProxmoxGuest): Promise<GuestNetworks> {
  const base = `nodes/${guest.node}/${guest.type}/${guest.vmid}`;
  if (guest.type === "lxc") {
    const response = await client.get(`${base}/interfaces`, responseSchema);
    return classify(
      lxcInterfacesSchema.parse(response.data).flatMap((nic) => {
        const [ip, prefix] = (nic.inet ?? "").split("/");
        return ip ? [{ name: nic.name, ip, prefix: prefix ? Number(prefix) : undefined }] : [];
      }),
    );
  }
  const response = await client.get(`${base}/agent/network-get-interfaces`, responseSchema);
  return classify(
    agentInterfacesSchema.parse(response.data).result.flatMap((nic) =>
      nic["ip-addresses"]
        .filter((entry) => entry["ip-address-type"] === "ipv4")
        .map((entry) => ({ name: nic.name, ip: entry["ip-address"], prefix: entry.prefix })),
    ),
  );
}

// A failed lookup (timeout, guest agent still starting after a boot) keeps
// the last known addresses, so services and containers do not drop out of
// the tree. It is retried after 30 s, then after twice as long on every
// further failure, up to 10 minutes: a VM with the agent enabled but not
// installed would otherwise cost a slow call every 30 s. The overview waits
// at most 1 s for a lookup; a slower one finishes in the background and
// its result shows on the next refresh.
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 10 * 60_000;
export const ADDRESS_WAIT_MS = 1_000;

type Entry = { at: number; failures: number; networks: GuestNetworks };
const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<GuestNetworks>>();
let cachedFor: HttpClient | undefined;
const none: GuestNetworks = { addresses: [], dockerNetworks: [] };

function freshFor(entry: Entry): number {
  return entry.failures === 0 ? CACHE_MS : Math.min(RETRY_MS * 2 ** (entry.failures - 1), MAX_RETRY_MS);
}

// Never throws: a guest without an agent, or a token without the right
// permission, just has no addresses.
export async function getGuestNetworks(client: HttpClient, guest: ProxmoxGuest): Promise<GuestNetworks> {
  if (guest.status !== "running") return none;
  // A new client means new settings (another Proxmox): forget everything.
  if (cachedFor !== client) {
    cache.clear();
    inFlight.clear();
    cachedFor = client;
  }
  const key = `${guest.node}/${guest.vmid}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < freshFor(cached)) return cached.networks;

  let lookup = inFlight.get(key);
  // False once settings changed or the guest was deleted meanwhile.
  const current = () => cachedFor === client && inFlight.get(key) === lookup;
  if (!lookup) {
    lookup = fetchNetworks(client, guest)
      .then(
        (networks) => {
          if (current()) cache.set(key, { at: Date.now(), failures: 0, networks });
          return networks;
        },
        () => {
          const previous = cache.get(key);
          const networks = previous?.networks ?? none;
          if (current()) {
            cache.set(key, { at: Date.now(), failures: (previous?.failures ?? 0) + 1, networks });
          }
          return networks;
        },
      )
      .finally(() => {
        if (inFlight.get(key) === lookup) inFlight.delete(key);
      });
    inFlight.set(key, lookup);
  }

  let timer: NodeJS.Timeout | undefined;
  const waited = new Promise<GuestNetworks>((resolve) => {
    timer = setTimeout(() => resolve(cached?.networks ?? none), ADDRESS_WAIT_MS);
  });
  const networks = await Promise.race([lookup, waited]);
  clearTimeout(timer);
  return networks;
}

// Drops what is kept for guests that no longer exist, so deleted guests do
// not pile up. Called with every guest of a fresh overview.
export function forgetOtherGuests(client: HttpClient, guests: Pick<ProxmoxGuest, "node" | "vmid">[]): void {
  if (cachedFor !== client) return;
  const keep = new Set(guests.map((guest) => `${guest.node}/${guest.vmid}`));
  for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
  for (const key of inFlight.keys()) if (!keep.has(key)) inFlight.delete(key);
}

// For tests: the guests something is kept for.
export function rememberedGuests(): string[] {
  return [...new Set([...cache.keys(), ...inFlight.keys()])].sort();
}
