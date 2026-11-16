import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostResolver, placeDockerHost, placeServices } from "./placement";
import type { GuestWithAddresses } from "./proxmox";
import type { ServiceStatus } from "./services";

const guest = (vmid: number, addresses: string[], dockerNetworks: string[]) =>
  ({
    node: "pve",
    vmid,
    type: "lxc",
    status: "running",
    name: `guest${vmid}`,
    cpu: 0,
    maxcpu: 1,
    mem: 0,
    maxmem: 0,
    uptime: 0,
    addresses,
    dockerNetworks,
  }) as GuestWithAddresses;

const service = (key: string, host: string) =>
  ({ key, name: key, host, result: { status: "ok", data: { stats: [], issues: [] } }, actions: [] }) as ServiceStatus;

const keys = (services: ServiceStatus[] | undefined) => (services ?? []).map((item) => item.key).sort();

describe("placeServices", () => {
  const servarr = guest(101, ["192.168.0.101"], ["172.17.0.1/16", "172.20.0.1/16"]);
  const immich = guest(103, ["192.168.0.103"], []);

  it("places services by LAN address and by Docker network", async () => {
    const placed = await placeServices(
      [servarr, immich],
      [
        service("sonarr", "172.20.0.5"), // container name resolved inside servarr's compose network
        service("radarr", "172.20.0.6"),
        service("immich", "192.168.0.103"),
        service("jellyfin", "10.9.9.9"),
      ],
    );
    expect(keys(placed.get("pve/101"))).toEqual(["radarr", "sonarr"]);
    expect(keys(placed.get("pve/103"))).toEqual(["immich"]);
    expect([...placed.values()].flat().some((item) => item.key === "jellyfin")).toBe(false);
  });

  it("does not guess when a Docker range exists on several guests", async () => {
    const second = guest(104, ["192.168.0.104"], ["172.20.0.1/16"]);
    expect((await placeServices([servarr, second], [service("sonarr", "172.20.0.5")])).size).toBe(0);
    // A LAN address is still unambiguous.
    expect((await placeServices([servarr, second], [service("x", "192.168.0.104")])).has("pve/104")).toBe(true);
  });
});

describe("placeServices with the Docker host", () => {
  // VM without guest agent rights: no addresses, no Docker networks.
  const vm = guest(101, [], []);
  const docker = { guest: "pve/101", containers: [{ name: "sonarr" }, { name: "servarr-radarr-1", composeService: "radarr" }] };

  it("places services reached by container or compose service name on the Docker host's guest", async () => {
    const placed = await placeServices(
      [vm],
      [service("sonarr", "Sonarr"), service("radarr", "radarr"), service("jellyfin", "unknown-host.invalid")],
      docker,
    );
    expect(keys(placed.get("pve/101"))).toEqual(["radarr", "sonarr"]);
  });

  it("prefers a LAN address match over a container name", async () => {
    // "jellyfin" is a container on the Docker host's guest (101), but the
    // name resolves to the LAN address of another guest (102).
    const lxc = guest(102, ["192.168.0.102"], []);
    const resolve = async (host: string) => (host === "jellyfin" ? ["192.168.0.102"] : []);
    const placed = await placeServices(
      [vm, lxc],
      [service("jellyfin", "jellyfin")],
      { guest: "pve/101", containers: [{ name: "jellyfin" }] },
      resolve,
    );
    expect(keys(placed.get("pve/102"))).toEqual(["jellyfin"]);
    expect(placed.has("pve/101")).toBe(false);
  });
});

describe("placeDockerHost", () => {
  const vm = guest(101, ["192.168.0.101"], ["172.17.0.1/16", "172.20.0.1/16"]);
  const other = guest(102, ["192.168.0.102"], ["172.17.0.1/16"]);

  it("matches the host name to the guest name", async () => {
    expect(placeDockerHost([vm, other], { name: "GUEST101", gateways: [] })).toBe("pve/101");
  });

  it("matches the set of Docker network gateways, and does not guess between guests", async () => {
    const host = (gateways: string[]) => ({ name: "docker", gateways });
    expect(placeDockerHost([vm, other], host(["172.17.0.1", "172.20.0.1"]))).toBe("pve/101");
    expect(placeDockerHost([vm, other], host(["172.17.0.1"]))).toBeUndefined();
    expect(placeDockerHost([vm, other], host([]))).toBeUndefined();
  });

  it("falls back to the address SafeHub was opened at", () => {
    expect(placeDockerHost([vm, other], { name: "docker", gateways: [] }, "192.168.0.102")).toBe("pve/102");
    expect(placeDockerHost([vm, other], { name: "docker", gateways: [] }, "safehub.lan")).toBeUndefined();
  });
});

describe("createHostResolver", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up on a slow lookup after 500 ms and uses its answer once it arrives", async () => {
    const lookup = vi.fn(
      (host: string) => new Promise<string[]>((resolve) => setTimeout(() => resolve([`192.168.0.${host.length}`]), 3_000)),
    );
    const resolve = createHostResolver(lookup);

    const first = resolve("sonarr");
    const second = resolve("sonarr");
    await vi.advanceTimersByTimeAsync(500);
    expect(await first).toEqual([]);
    expect(await second).toEqual([]);
    // Parallel callers share one lookup.
    expect(lookup).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(await resolve("sonarr")).toEqual(["192.168.0.6"]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("caches answers for a minute and failures for 10 s", async () => {
    let fail = true;
    const lookup = vi.fn(async () => {
      if (fail) throw new Error("ENOTFOUND");
      return ["192.168.0.9"];
    });
    const resolve = createHostResolver(lookup);

    expect(await resolve("jellyfin")).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await resolve("jellyfin")).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(1);

    fail = false;
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await resolve("jellyfin")).toEqual(["192.168.0.9"]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(await resolve("jellyfin")).toEqual(["192.168.0.9"]);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("never looks up an IP address", async () => {
    const lookup = vi.fn(async () => ["10.0.0.1"]);
    expect(await createHostResolver(lookup)("192.168.0.5")).toEqual(["192.168.0.5"]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("is used by placeServices", async () => {
    const vm = guest(150, ["192.168.0.150"], []);
    const resolve = createHostResolver(async () => ["192.168.0.150"]);
    const placed = await placeServices([vm], [service("immich", "immich.lan")], undefined, resolve);
    expect(keys(placed.get("pve/150"))).toEqual(["immich"]);
  });
});
