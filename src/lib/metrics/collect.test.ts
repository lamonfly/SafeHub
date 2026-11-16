import { beforeAll, describe, expect, it, vi } from "vitest";
import type { DockerContainer } from "@/lib/integrations/docker";

// The adapters are replaced: these tests are about how a round copes with
// parts that fail, not about the services.
const synology = vi.hoisted(() => ({ overview: vi.fn() }));
vi.mock("@/lib/integrations/synology", () => ({
  isSynologyConfigured: () => true,
  getSynologyOverview: synology.overview,
}));
vi.mock("@/lib/integrations/proxmox", () => ({
  isProxmoxConfigured: () => {
    // e.g. createTlsAgent reading a CA file that was removed
    throw new Error("ENOENT: no such file or directory, open '/app/certs/pve.pem'");
  },
  getProxmoxOverview: vi.fn(),
  backupMaxAgeDays: () => 7,
}));
vi.mock("@/lib/integrations/docker", async (importOriginal) => ({
  isDockerConfigured: () => false,
  getDockerHost: vi.fn(),
  getContainerStats: vi.fn(),
  minutesUp: (await importOriginal<typeof import("@/lib/integrations/docker")>()).minutesUp,
}));
const ports = vi.hoisted(() => ({ check: vi.fn(async () => ({ status: "ok", data: { forwardedPort: 51413, listenPort: 6881 } })) }));
vi.mock("@/lib/integrations/qbittorrent", () => ({ getPortForwardMismatch: ports.check }));
vi.mock("@/lib/integrations/services", () => ({
  hasConfiguredServices: () => true,
  getServiceStatuses: async () => [
    { key: "sonarr", name: "Sonarr", result: { status: "error", message: "Sonarr 401 Unauthorized" } },
    { key: "radarr", name: "Radarr", result: { status: "ok", data: {} } },
  ],
}));

let collect: typeof import("./collect");

beforeAll(async () => {
  collect = await import("./collect");
});

describe("a sample round", () => {
  it("keeps the other parts when one throws, and logs it once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    synology.overview.mockResolvedValue({
      status: "ok",
      data: {
        cpuPercent: 12,
        memory: { usedPercent: 40, totalBytes: 1 },
        volumes: [{ name: "Volume 1", status: "degraded", usedBytes: 50, totalBytes: 100 }],
        disks: [{ name: "Drive 1", status: "normal" }],
      },
    });
    const snapshot = await collect.collect();
    const values = Object.fromEntries(snapshot.readings.map((reading) => [reading.series, reading.value]));
    expect(values).toMatchObject({ "synology:up": 1, "synology:cpu": 12, "synology:volume:Volume 1": 50, "service:sonarr:up": 0, "service:radarr:up": 1 });
    expect(values["qbittorrent:port-forward"]).toBe(0);
    expect(snapshot.portForward).toEqual({ status: "ok", mismatch: { forwardedPort: 51413, listenPort: 6881 } });
    expect(snapshot.volumes).toEqual([{ key: "volume:synology:Volume 1", label: "Synology Volume 1", status: "degraded" }]);
    // Proxmox threw before its first reading: counted as down, with the error.
    expect(snapshot.readings.find((reading) => reading.series === "proxmox:up")).toMatchObject({
      value: 0,
      failure: { reason: "unreachable", detail: expect.stringContaining("ENOENT") },
    });
    expect(snapshot.failed).toEqual(new Set(["proxmox"]));
    expect(snapshot.readings.find((reading) => reading.series === "service:sonarr:up")?.failure).toEqual({
      reason: "login rejected",
      detail: "Sonarr 401 Unauthorized",
    });

    await collect.collect();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("Metrics: Proxmox failed: ENOENT");
    warn.mockRestore();
  });

  it("survives a part that throws synchronously", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    synology.overview.mockImplementation(() => {
      throw new Error("boom");
    });
    const snapshot = await collect.collect();
    expect(snapshot.readings.find((reading) => reading.series === "synology:up")).toMatchObject({ value: 0, failure: { detail: "boom" } });
    expect(snapshot.readings.some((reading) => reading.series === "service:radarr:up")).toBe(true);
    expect(snapshot.failed?.has("synology")).toBe(true);
    // A failed port check: no sample, nothing known.
    ports.check.mockResolvedValueOnce({ status: "error", message: "Gluetun 500" } as never);
    const next = await collect.collect();
    expect(next.portForward).toBeUndefined();
    expect(next.readings.some((reading) => reading.series === "qbittorrent:port-forward")).toBe(false);
    warn.mockRestore();
  });
});

describe("crash loop tracking", () => {
  const MINUTE = 60_000;
  const container = (restartCount: number | undefined, id = "a".repeat(64)): DockerContainer => ({
    id, name: "sonarr", image: "sonarr", state: "running", status: "Up 40 seconds", ports: [], self: false, restartCount,
  });

  it("counts restarts within 15 minutes from the restart count", () => {
    const history: import("./collect").RestartHistory = new Map();
    let now = Date.UTC(2026, 10, 14, 10, 0, 0);
    // First reading: only the baseline, the 7 old restarts do not count.
    expect(collect.trackRestarts(history, [container(7)], now).get("sonarr")).toBe(0);
    now += MINUTE;
    expect(collect.trackRestarts(history, [container(8)], now).get("sonarr")).toBe(1);
    now += MINUTE;
    // Not inspected this round (started long ago): history stays.
    expect(collect.trackRestarts(history, [container(undefined)], now).get("sonarr")).toBe(1);
    now += MINUTE;
    expect(collect.trackRestarts(history, [container(10)], now).get("sonarr")).toBe(3);
    now += 15 * MINUTE;
    expect(collect.trackRestarts(history, [container(undefined)], now).get("sonarr")).toBe(0);
    // Recreated (new ID, count back to 0): starts over without counting.
    expect(collect.trackRestarts(history, [container(0, "b".repeat(64))], now).get("sonarr")).toBe(0);
    // Removed: forgotten.
    collect.trackRestarts(history, [], now);
    expect(history.size).toBe(0);
  });

  it("passes the count to the container readings", () => {
    const { containers } = collect.containerReadings([container(3)], new Map([["sonarr", 3]]));
    expect(containers[0].recentRestarts).toBe(3);
  });

  it("knows there were no restarts without a count when up longer than the window or stopped on purpose", () => {
    const recent = (state: string, status: string, exitCode?: number) =>
      collect.containerReadings([{ ...container(undefined), state, status, exitCode }]).containers[0].recentRestarts;
    // After a SafeHub restart the history is empty.
    expect(recent("running", "Up 20 minutes (healthy)")).toBe(0);
    expect(recent("running", "Up About an hour")).toBe(0);
    expect(recent("running", "Up 3 days")).toBe(0);
    expect(recent("exited", "Exited (0) 1 minute ago", 0)).toBe(0);
    // Could have restarted within the last 15 minutes: unknown.
    expect(recent("running", "Up 5 minutes")).toBeUndefined();
    expect(recent("restarting", "Restarting (1) 5 seconds ago")).toBeUndefined();
    expect(recent("exited", "Exited (1) 1 minute ago", 1)).toBeUndefined();
  });
});
