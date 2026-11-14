import { describe, expect, it } from "vitest";
import { placeServices } from "./placement";
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
  ({ key, name: key, host, result: { status: "ok", data: { stats: [], issues: [] } } }) as ServiceStatus;

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
