import "server-only";
import { isIPv4 } from "node:net";
import { z } from "zod";
import type { HttpClient } from "../http";
import { responseSchema, type ProxmoxGuest } from "./schemas";

// IPv4 addresses of running guests, used to place services under the guest
// they run on.
//   LXC: /lxc/{vmid}/interfaces (needs only read access)
//   VM:  the QEMU guest agent; without the agent the VM has no addresses here
// Addresses rarely change, so each guest is asked at most every 5 minutes.

const CACHE_MS = 5 * 60_000;

// Docker and other virtual bridges inside a guest are not how the LAN
// reaches it.
const ignoredInterface = /^(lo|docker\d*|br-|veth|virbr|cni|flannel|tailscale|zt)/;

const lxcInterfacesSchema = z.array(
  z.object({ name: z.string(), inet: z.string().optional() }),
);

const agentInterfacesSchema = z.object({
  result: z.array(
    z.object({
      name: z.string(),
      "ip-addresses": z
        .array(z.object({ "ip-address": z.string(), "ip-address-type": z.string() }))
        .default([]),
    }),
  ),
});

function usable(name: string, address: string | undefined): address is string {
  return !!address && !ignoredInterface.test(name) && isIPv4(address) && !address.startsWith("127.");
}

async function fetchAddresses(client: HttpClient, guest: ProxmoxGuest): Promise<string[]> {
  const base = `nodes/${guest.node}/${guest.type}/${guest.vmid}`;
  if (guest.type === "lxc") {
    const response = await client.get(`${base}/interfaces`, responseSchema);
    return lxcInterfacesSchema
      .parse(response.data)
      .map((nic) => ({ name: nic.name, ip: nic.inet?.split("/")[0] }))
      .filter((nic) => usable(nic.name, nic.ip))
      .map((nic) => nic.ip!);
  }
  const response = await client.get(`${base}/agent/network-get-interfaces`, responseSchema);
  return agentInterfacesSchema
    .parse(response.data)
    .result.flatMap((nic) =>
      nic["ip-addresses"]
        .filter((entry) => entry["ip-address-type"] === "ipv4")
        .map((entry) => ({ name: nic.name, ip: entry["ip-address"] })),
    )
    .filter((nic) => usable(nic.name, nic.ip))
    .map((nic) => nic.ip);
}

const cache = new Map<string, { at: number; addresses: string[] }>();

// Never throws: a guest without an agent, or a token without the right
// permission, just has no addresses.
export async function getGuestAddresses(client: HttpClient, guest: ProxmoxGuest): Promise<string[]> {
  if (guest.status !== "running") return [];
  const key = `${guest.node}/${guest.vmid}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.addresses;

  const addresses = await fetchAddresses(client, guest).catch(() => []);
  cache.set(key, { at: Date.now(), addresses });
  return addresses;
}
