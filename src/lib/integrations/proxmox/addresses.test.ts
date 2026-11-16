import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../http";
import { ADDRESS_WAIT_MS, forgetOtherGuests, getGuestNetworks, rememberedGuests } from "./addresses";
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

  it("backs off longer after every further failure, up to 10 minutes", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const client = {
      get: async () => {
        calls++;
        throw new Error("QEMU guest agent is not running");
      },
    } as unknown as HttpClient;
    const guest = running(130, "qemu");
    const attemptsWithin = async (ms: number) => {
      const before = calls;
      for (let elapsed = 0; elapsed < ms; elapsed += 10_000) {
        await getGuestNetworks(client, guest);
        await vi.advanceTimersByTimeAsync(10_000);
      }
      return calls - before;
    };
    await getGuestNetworks(client, guest); // failure 1: retry after 30 s
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    await getGuestNetworks(client, guest);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    await getGuestNetworks(client, guest); // failure 2: retry after 60 s
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(50_000);
    await getGuestNetworks(client, guest);
    expect(calls).toBe(2);
    // After many failures, one attempt per 10 minutes at most.
    await attemptsWithin(60 * 60_000);
    const lastHalfHour = await attemptsWithin(30 * 60_000);
    expect(lastHalfHour).toBeGreaterThanOrEqual(2);
    expect(lastHalfHour).toBeLessThanOrEqual(3);
    vi.useRealTimers();
  });

  it("waits at most 1 s for a slow lookup and keeps the last known addresses meanwhile", async () => {
    vi.useFakeTimers();
    let slow = false;
    const client = {
      get: async () => {
        if (slow) await new Promise((resolve) => setTimeout(resolve, 4_000));
        return { data: [{ name: "eth0", inet: slow ? "192.168.0.141/24" : "192.168.0.140/24" }] };
      },
    } as unknown as HttpClient;
    const guest = running(140, "lxc");
    expect((await getGuestNetworks(client, guest)).addresses).toEqual(["192.168.0.140"]);

    slow = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 1);
    const pending = getGuestNetworks(client, guest);
    await vi.advanceTimersByTimeAsync(ADDRESS_WAIT_MS);
    expect((await pending).addresses).toEqual(["192.168.0.140"]);

    // The lookup finished in the background: the next call has the new data.
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await getGuestNetworks(client, guest)).addresses).toEqual(["192.168.0.141"]);
    vi.useRealTimers();
  });

  it("forgets deleted guests, including a lookup still running", async () => {
    vi.useFakeTimers();
    const client = {
      get: async (path: string) => {
        if (path.includes("/202/")) await new Promise((resolve) => setTimeout(resolve, 4_000));
        return { data: [{ name: "eth0", inet: "192.168.0.200/24" }] };
      },
    } as unknown as HttpClient;
    await getGuestNetworks(client, running(200, "lxc"));
    await getGuestNetworks(client, running(201, "lxc"));
    const slow = getGuestNetworks(client, running(202, "lxc"));
    await vi.advanceTimersByTimeAsync(ADDRESS_WAIT_MS);
    await slow;
    expect(rememberedGuests()).toEqual(["pve/200", "pve/201", "pve/202"]);

    // 201 and 202 were deleted.
    forgetOtherGuests(client, [{ node: "pve", vmid: 200 }]);
    expect(rememberedGuests()).toEqual(["pve/200"]);
    // The running lookup of 202 finishes without adding it back.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(rememberedGuests()).toEqual(["pve/200"]);
    vi.useRealTimers();
  });
});
