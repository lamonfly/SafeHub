import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../http";
import { getGuestNetworks } from "./addresses";
import type { ProxmoxGuest } from "./schemas";

const fakeClient = (data: unknown) => ({ get: async () => ({ data }) }) as unknown as HttpClient;
const running = (vmid: number, type: "lxc" | "qemu") => ({ node: "pve", vmid, type, status: "running" }) as ProxmoxGuest;

describe("getGuestNetworks", () => {
  it("splits LXC interfaces into LAN addresses and Docker networks", async () => {
    const networks = await getGuestNetworks(
      fakeClient([
        { name: "lo", inet: "127.0.0.1/8" },
        { name: "eth0", inet: "192.168.0.101/24" },
        { name: "docker0", inet: "172.17.0.1/16" },
        { name: "br-3f2a9c1d", inet: "172.20.0.1/16" },
        { name: "veth12ab" },
      ]),
      running(101, "lxc"),
    );
    expect(networks).toEqual({ addresses: ["192.168.0.101"], dockerNetworks: ["172.17.0.1/16", "172.20.0.1/16"] });
  });

  it("reads VM addresses from the guest agent, IPv4 only", async () => {
    const networks = await getGuestNetworks(
      fakeClient({
        result: [
          {
            name: "ens18",
            "ip-addresses": [
              { "ip-address": "192.168.0.103", "ip-address-type": "ipv4", prefix: 24 },
              { "ip-address": "fe80::1", "ip-address-type": "ipv6", prefix: 64 },
            ],
          },
          { name: "br-77aa", "ip-addresses": [{ "ip-address": "172.18.0.1", "ip-address-type": "ipv4", prefix: 16 }] },
        ],
      }),
      running(103, "qemu"),
    );
    expect(networks).toEqual({ addresses: ["192.168.0.103"], dockerNetworks: ["172.18.0.1/16"] });
  });

  it("returns nothing for stopped guests and on errors", async () => {
    const failing = { get: async () => Promise.reject(new Error("no agent")) } as unknown as HttpClient;
    expect(await getGuestNetworks(failing, running(110, "qemu"))).toEqual({ addresses: [], dockerNetworks: [] });
    const stopped = { ...running(111, "lxc"), status: "stopped" } as ProxmoxGuest;
    expect(await getGuestNetworks(fakeClient([]), stopped)).toEqual({ addresses: [], dockerNetworks: [] });
  });

  it("keeps the last known addresses after a failure and retries after 30 s", async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
    let fail = false;
    const client = {
      get: async () => (fail ? Promise.reject(new Error("timeout")) : { data: [{ name: "eth0", inet: "192.168.0.120/24" }] }),
    } as unknown as HttpClient;
    const guest = running(120, "lxc");
    expect((await getGuestNetworks(client, guest)).addresses).toEqual(["192.168.0.120"]);
    fail = true;
    now += 5 * 60_000 + 1; // cache expired, lookup fails
    expect((await getGuestNetworks(client, guest)).addresses).toEqual(["192.168.0.120"]);
    fail = false;
    now += 30_001;
    expect((await getGuestNetworks(client, guest)).addresses).toEqual(["192.168.0.120"]);
    clock.mockRestore();
  });
});
