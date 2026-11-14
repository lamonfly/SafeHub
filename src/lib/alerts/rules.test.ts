import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";
import type { Reading, Snapshot, Source } from "@/lib/metrics/collect";

let rules: typeof import("./rules");
let store: typeof import("./store");
let metrics: typeof import("@/lib/metrics/store");

beforeAll(async () => {
  await migratedDb();
  rules = await import("./rules");
  store = await import("./store");
  metrics = await import("@/lib/metrics/store");
});

const MINUTE = 60_000;
let clock = Date.UTC(2026, 10, 14, 10, 0, 0);

// One sampler round: save the readings, then check the rules.
function step(readings: Reading[], disks: Snapshot["disks"] = [], reachable: Source[] = ["synology", "proxmox"]) {
  metrics.saveSamples(clock, readings.map(({ series, value }) => ({ series, value })));
  rules.evaluateAlerts({ readings, disks, reachable: new Set(reachable) }, new Date(clock));
  clock += MINUTE;
}
const find = (key: string) => store.listAlerts().find((item) => item.key === key);

const cpu = (value: number): Reading => ({ series: "synology:cpu", value, kind: "cpu", label: "Synology", source: "synology" });
const volume = (value: number): Reading => ({ series: "synology:volume:/volume1", value, kind: "volume", label: "Synology /volume1", source: "synology" });
const up = (key: string, value: number): Reading => ({ series: `service:${key}:up`, value, kind: "up", label: key, graceMinutes: 3 });

describe("usage alerts", () => {
  it("open after 5 minutes above 90%, stay between thresholds, close below 85%", () => {
    for (let minute = 0; minute < 4; minute++) step([cpu(97)]);
    expect(find("synology:cpu")).toBeUndefined();
    step([cpu(99)]);
    expect(find("synology:cpu")).toMatchObject({ severity: "warning", endedAt: null, peak: 99 });
    step([cpu(88)]);
    expect(find("synology:cpu")?.endedAt).toBeNull();
    step([cpu(70)]);
    expect(find("synology:cpu")?.endedAt).toBeInstanceOf(Date);
  });
});

describe("volume alerts", () => {
  it("warn at 85%, escalate at 95% (unread again), survive an outage, close below 83%", () => {
    step([volume(87)]);
    expect(find("synology:volume:/volume1")?.severity).toBe("warning");
    store.markAllRead();
    step([volume(96)]);
    expect(find("synology:volume:/volume1")).toMatchObject({ severity: "critical", readAt: null });
    step([], [], ["proxmox"]); // Synology unreachable: nothing known, keep the alert
    expect(find("synology:volume:/volume1")?.endedAt).toBeNull();
    step([volume(80)]);
    expect(find("synology:volume:/volume1")?.endedAt).toBeInstanceOf(Date);
  });
});

describe("availability alerts", () => {
  it("open after the grace period and close when the service answers", () => {
    step([up("sonarr", 0)]);
    step([up("sonarr", 0)]);
    expect(find("service:sonarr:up")).toBeUndefined();
    step([up("sonarr", 0)]);
    expect(find("service:sonarr:up")).toMatchObject({ severity: "critical", title: "sonarr: unreachable" });
    step([up("sonarr", 1)]);
    expect(find("service:sonarr:up")?.endedAt).toBeInstanceOf(Date);
  });

  it("close when the service is removed from the settings", () => {
    for (let minute = 0; minute < 3; minute++) step([up("caddy", 0)]);
    expect(find("service:caddy:up")?.endedAt).toBeNull();
    step([]);
    expect(find("service:caddy:up")?.endedAt).toBeInstanceOf(Date);
  });
});

describe("disk and guest alerts", () => {
  it("flag unhealthy disks until they are normal again", () => {
    step([], [{ key: "disk:synology:Drive 3", label: "Synology Drive 3", status: "warning" }]);
    expect(find("disk:synology:Drive 3")?.severity).toBe("critical");
    step([], [{ key: "disk:synology:Drive 3", label: "Synology Drive 3", status: "normal" }]);
    expect(find("disk:synology:Drive 3")?.endedAt).toBeInstanceOf(Date);
  });

  it("close a guest's alert when the guest stops, but only while Proxmox answers", () => {
    const guest = (value: number): Reading => ({ series: "guest:pve/101:cpu", value, kind: "cpu", label: "servarr", source: "proxmox" });
    for (let minute = 0; minute < 5; minute++) step([guest(95)]);
    step([], [], ["synology"]); // Proxmox unreachable
    expect(find("guest:pve/101:cpu")?.endedAt).toBeNull();
    step([], [], ["synology", "proxmox"]); // Proxmox answers, guest gone
    expect(find("guest:pve/101:cpu")?.endedAt).toBeInstanceOf(Date);
  });
});

describe("alert lists", () => {
  it("count only open problems for the badge and list open ones first", () => {
    expect(store.openAlerts()).toHaveLength(0);
    const all = store.listAlerts();
    expect(all.every((item) => item.endedAt instanceof Date)).toBe(true);
    // Newest first among resolved alerts, regardless of severity.
    const starts = all.map((item) => item.startedAt.getTime());
    expect(starts).toEqual([...starts].sort((a, b) => b - a));
  });
});
