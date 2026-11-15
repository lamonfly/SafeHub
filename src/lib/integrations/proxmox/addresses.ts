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

// A failed lookup (timeout, guest agent still starting after a boot) is
// asked again sooner, and keeps the last known addresses meanwhile, so
// services and containers do not drop out of the tree for minutes.
const RETRY_MS = 30_000;

const cache = new Map<string, { at: number; ok: boolean; networks: GuestNetworks }>();
let cachedFor: HttpClient | undefined;
const none: GuestNetworks = { addresses: [], dockerNetworks: [] };

// Never throws: a guest without an agent, or a token without the right
// permission, just has no addresses.
export async function getGuestNetworks(client: HttpClient, guest: ProxmoxGuest): Promise<GuestNetworks> {
  if (guest.status !== "running") return none;
  // A new client means new settings (another Proxmox): forget everything.
  if (cachedFor !== client) {
    cache.clear();
    cachedFor = client;
  }
  const key = `${guest.node}/${guest.vmid}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < (cached.ok ? CACHE_MS : RETRY_MS)) return cached.networks;

  try {
    const networks = await fetchNetworks(client, guest);
    cache.set(key, { at: Date.now(), ok: true, networks });
    return networks;
  } catch {
    const networks = cached?.networks ?? none;
    cache.set(key, { at: Date.now(), ok: false, networks });
    return networks;
  }
}
