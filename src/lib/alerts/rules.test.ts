import { beforeAll, describe, expect, it } from "vitest";
import { migratedDb } from "../../../tests/support/helpers";
import type { Reading, Snapshot, Source } from "@/lib/metrics/collect";

let rules: typeof import("./rules");
let store: typeof import("./store");
let metrics: typeof import("@/lib/metrics/store");
let collect: typeof import("@/lib/metrics/collect");

beforeAll(async () => {
  await migratedDb();
  rules = await import("./rules");
  store = await import("./store");
  metrics = await import("@/lib/metrics/store");
  collect = await import("@/lib/metrics/collect");
});

const MINUTE = 60_000;
let clock = Date.UTC(2026, 10, 14, 10, 0, 0);

// One sampler round: save the readings, then check the rules.
// Returns the change events of that round (what notifications are sent for).
function step(
  readings: Reading[],
  disks: Snapshot["disks"] = [],
  reachable: Source[] = ["synology", "proxmox"],
  configured: Source[] = ["synology", "proxmox"],
) {
  metrics.saveSamples(clock, readings.map(({ series, value }) => ({ series, value })));
  const events = rules.evaluateAlerts(
    { readings, disks, reachable: new Set(reachable), configured: new Set(configured) },
    new Date(clock),
  );
  clock += MINUTE;
  return events.map((item) => `${item.type} ${item.severity} ${item.title}`);
}
const find = (key: string) => store.listAlerts().find((item) => item.key === key);

const cpu = (value: number): Reading => ({ series: "synology:cpu", value, kind: "cpu", label: "Synology", source: "synology" });
const volume = (value: number): Reading => ({ series: "synology:volume:/volume1", value, kind: "volume", label: "Synology /volume1", source: "synology" });
const up = (key: string, value: number): Reading => ({ series: `service:${key}:up`, value, kind: "up", label: key, graceMinutes: 3 });

describe("usage alerts", () => {
  it("open after 5 minutes above 90%, stay between thresholds, close below 85%", () => {
    for (let minute = 0; minute < 4; minute++) expect(step([cpu(97)])).toEqual([]);
    expect(find("synology:cpu")).toBeUndefined();
    expect(step([cpu(99)])).toEqual(["opened warning Synology: CPU high"]);
    expect(find("synology:cpu")).toMatchObject({ severity: "warning", endedAt: null, peak: 99 });
    expect(step([cpu(88)])).toEqual([]);
    expect(find("synology:cpu")?.endedAt).toBeNull();
    expect(step([cpu(70)])).toEqual(["resolved warning Synology: CPU high"]);
    expect(find("synology:cpu")?.endedAt).toBeInstanceOf(Date);
  });
});

describe("volume alerts", () => {
  it("warn at 85%, escalate at 95% (unread again), survive an outage, close below 83%", () => {
    step([volume(87)]);
    expect(find("synology:volume:/volume1")?.severity).toBe("warning");
    store.markAllRead();
    expect(step([volume(96)])).toEqual(["escalated critical Synology /volume1: almost full"]);
    expect(find("synology:volume:/volume1")).toMatchObject({ severity: "critical", readAt: null });
    step([], [], ["proxmox"]); // Synology unreachable: nothing known, keep the alert
    expect(find("synology:volume:/volume1")?.endedAt).toBeNull();
    step([volume(80)]);
    expect(find("synology:volume:/volume1")?.endedAt).toBeInstanceOf(Date);
  });

  it("keep a muted alert muted when it escalates", () => {
    const vol = (value: number): Reading => ({ ...volume(value), series: "synology:volume:/volume9" });
    step([vol(86)]);
    const id = find("synology:volume:/volume9")!.id;
    expect(store.muteAlert(id, "1h", clock)).toBe(true);
    metrics.saveSamples(clock, [{ series: "synology:volume:/volume9", value: 97 }]);
    const events = rules.evaluateAlerts({ readings: [vol(97)], disks: [], reachable: new Set<Source>(["synology"]) }, new Date(clock));
    clock += MINUTE;
    expect(events).toMatchObject([{ type: "escalated", key: "synology:volume:/volume9", mutedUntil: new Date(clock - MINUTE + 3_600_000) }]);
    step([vol(10)]);
  });

  it("close when Synology is removed from the settings", () => {
    step([volume(97)]);
    expect(find("synology:volume:/volume1")?.endedAt).toBeNull();
    expect(step([], [], [], ["proxmox"])).toEqual(["resolved critical Synology /volume1: almost full"]);
  });
});

describe("old samples", () => {
  it("do not count as sustained after a gap (restart)", () => {
    for (let minute = 0; minute < 4; minute++) step([cpu(97)]);
    clock += 60 * MINUTE; // SafeHub was down for an hour
    expect(step([cpu(97)])).toEqual([]);
    expect(find("synology:cpu")?.endedAt ?? null).not.toBeNull();
    for (let minute = 0; minute < 5; minute++) step([cpu(10)]);
  });
});

describe("availability alerts", () => {
  it("open after the grace period and close when the service answers", () => {
    step([up("sonarr", 0)]);
    step([up("sonarr", 0)]);
    expect(find("service:sonarr:up")).toBeUndefined();
    step([up("sonarr", 0)]);
    expect(find("service:sonarr:up")).toMatchObject({ severity: "critical", title: "sonarr: unreachable" });
    step([up("sonarr", 1)]); // one good answer is not enough (flapping)
    expect(find("service:sonarr:up")?.endedAt).toBeNull();
    step([up("sonarr", 1)]);
    expect(find("service:sonarr:up")?.endedAt).toBeInstanceOf(Date);
  });

  it("name the cause: login rejected, certificate changed, API changed, VPN down", () => {
    const failing = (key: string, failure: Reading["failure"]): Reading => ({ ...up(key, 0), failure });
    const login = { reason: "login rejected" as const, detail: "Sonarr 401 Unauthorized" };
    step([failing("sonarr2", login)]);
    step([failing("sonarr2", login)]);
    expect(step([failing("sonarr2", login)])).toEqual(["opened critical sonarr2: login rejected"]);
    expect(find("service:sonarr2:up")?.message).toBe("For 3+ minutes. Sonarr 401 Unauthorized.");
    // A different cause later: same alert (same key and history), new text.
    step([failing("sonarr2", { reason: "unreachable", detail: "Request timed out." })]);
    expect(find("service:sonarr2:up")).toMatchObject({
      title: "sonarr2: unreachable",
      message: "No answer for 3+ minutes. Request timed out.",
      endedAt: null,
    });
    step([up("sonarr2", 1)]);
    step([up("sonarr2", 1)]);
    expect(find("service:sonarr2:up")?.endedAt).toBeInstanceOf(Date);
  });

  it("keep service alerts when the services part of the round failed", () => {
    for (let minute = 0; minute < 3; minute++) step([up("lidarr", 0)]);
    const events = rules.evaluateAlerts(
      { readings: [], disks: [], reachable: new Set<Source>(["synology", "proxmox"]), configured: new Set<Source>(["synology", "proxmox"]), failed: new Set(["services"]) },
      new Date(clock),
    );
    clock += MINUTE;
    expect(events).toEqual([]);
    expect(find("service:lidarr:up")?.endedAt).toBeNull();
    step([]); // services answered again, lidarr is gone from the settings
    expect(find("service:lidarr:up")?.endedAt).toBeInstanceOf(Date);
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
    const drive = (status: string) => [{ key: "disk:synology:Drive 3", label: "Synology Drive 3", status }];
    expect(step([], drive("warning"))).toEqual(["opened warning Synology Drive 3: warning"]);
    expect(step([], drive("crashed"))).toEqual(["escalated critical Synology Drive 3: crashed"]);
    expect(step([], drive("normal"))).toEqual(["resolved critical Synology Drive 3: crashed"]);
    expect(find("disk:synology:Drive 3")?.endedAt).toBeInstanceOf(Date);
  });

  it("ignore new and unused disks, alert on failing ones", () => {
    for (const status of ["not_initialized", "initialized", "not_use", "normal", "unknown"]) {
      step([], [{ key: "disk:synology:Drive 5", label: "Synology Drive 5", status }]);
      expect(find("disk:synology:Drive 5")).toBeUndefined();
    }
    for (const status of ["crashed", "failing", "system_partition_failed", "degraded", "critical"]) {
      expect(rules.diskSeverity(status)).toBe("critical");
    }
    for (const status of ["warning", "abnormal", "attention"]) {
      expect(rules.diskSeverity(status)).toBe("warning");
    }
  });

  it("alert on degraded or crashed volumes", () => {
    const volumeRound = (status: string, reachable: Source[] = ["synology", "proxmox"]) => {
      const events = rules.evaluateAlerts(
        { readings: [], disks: [], volumes: status ? [{ key: "volume:synology:Volume 1", label: "Synology Volume 1", status }] : [], reachable: new Set(reachable), configured: new Set<Source>(["synology", "proxmox"]) },
        new Date(clock),
      );
      clock += MINUTE;
      return events.map((item) => `${item.type} ${item.severity} ${item.title}`);
    };
    expect(volumeRound("data_scrubbing")).toEqual([]);
    expect(volumeRound("attention")).toEqual(["opened warning Synology Volume 1: attention"]);
    expect(volumeRound("degraded")).toEqual(["escalated critical Synology Volume 1: degraded"]);
    expect(volumeRound("", ["proxmox"])).toEqual([]); // Synology unreachable: keep
    expect(volumeRound("normal")).toEqual(["resolved critical Synology Volume 1: degraded"]);
    expect(volumeRound("crashed")).toEqual(["opened critical Synology Volume 1: crashed"]);
    expect(volumeRound("")).toEqual(["resolved critical Synology Volume 1: crashed"]); // volume removed
    expect(rules.volumeSeverity("read_only")).toBe("warning");
    expect(rules.volumeSeverity("expanding")).toBeNull();
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

describe("backup alerts", () => {
  const round = (extra: Pick<Snapshot, "backups" | "backupJobs">) => {
    const events = rules.evaluateAlerts({ readings: [], disks: [], reachable: new Set<Source>(["proxmox"]), ...extra }, new Date(clock));
    clock += MINUTE;
    return events.map((item) => `${item.type} ${item.severity} ${item.title}`);
  };
  const backup = (ageDays: number) => [{ key: "backup:pve/101", label: "servarr (LXC 101)", ageDays, maxAgeDays: 7 }];
  const job = (ok: boolean, status: string) => [{ key: "backup-job:pve", node: "pve", ok, status }];

  it("warn when the newest backup is older than the limit, keep it without data, close after a new backup", () => {
    expect(round({ backups: backup(3), backupJobs: [] })).toEqual([]);
    expect(round({ backups: backup(8.5), backupJobs: [] })).toEqual(["opened warning servarr (LXC 101): backup overdue"]);
    expect(find("backup:pve/101")?.message).toContain("8 days old (limit 7)");
    expect(round({})).toEqual([]); // storage not readable this round
    expect(find("backup:pve/101")?.endedAt).toBeNull();
    expect(round({ backups: backup(0.1), backupJobs: [] })).toEqual(["resolved warning servarr (LXC 101): backup overdue"]);
  });

  it("warn about a failed backup job until the next one succeeds", () => {
    expect(round({ backups: [], backupJobs: job(true, "WARNINGS: 1") })).toEqual([]);
    expect(round({ backups: [], backupJobs: job(false, "job errors") })).toEqual(["opened warning Backup job failed on pve"]);
    expect(round({})).toEqual([]);
    expect(round({ backups: [], backupJobs: job(true, "OK") })).toEqual(["resolved warning Backup job failed on pve"]);
  });
});

describe("Docker container alerts", () => {
  type Container = import("@/lib/integrations/docker").DockerContainer;
  const container = (state: string, status: string, exitCode?: number): Container => ({
    id: "a".repeat(64), name: "sonarr", image: "sonarr", state, status, exitCode, ports: [], self: false,
  });
  // One sampler round with only this container.
  function dockerStep(item: Container, recentRestarts?: number) {
    const { readings, containers } = collect.containerReadings(
      [item],
      recentRestarts === undefined ? undefined : new Map([[item.name, recentRestarts]]),
    );
    metrics.saveSamples(clock, readings.map(({ series, value }) => ({ series, value })));
    const events = rules.evaluateAlerts(
      { readings, disks: [], containers, reachable: new Set<Source>(["docker"]), configured: new Set<Source>(["docker"]) },
      new Date(clock),
    );
    clock += MINUTE;
    return events.map((item) => `${item.type} ${item.severity} ${item.title}`);
  }
  const running = container("running", "Up 2 hours (healthy)");
  const crashed = container("exited", "Exited (1) 1 minute ago", 1);

  it("open when a container that ran crashes, close when it runs again", () => {
    dockerStep(running);
    expect(dockerStep(crashed)).toEqual([]);
    expect(dockerStep(crashed)).toEqual(["opened critical sonarr: stopped (exit code 1)"]);
    dockerStep(running);
    expect(dockerStep(running)).toEqual(["resolved critical sonarr: stopped (exit code 1)"]);
  });

  it("name a crash loop, and close when stopped on purpose", () => {
    dockerStep(running);
    dockerStep(container("restarting", "Restarting (1) 5 seconds ago"));
    expect(dockerStep(container("restarting", "Restarting (1) 5 seconds ago"))).toEqual(["opened critical sonarr: keeps restarting"]);
    expect(dockerStep(container("exited", "Exited (0) 1 second ago", 0))).toEqual(["resolved critical sonarr: keeps restarting"]);
  });

  it("warn about an unhealthy container after 3 minutes", () => {
    const unhealthy = container("running", "Up 1 hour (unhealthy)");
    dockerStep(unhealthy);
    dockerStep(unhealthy);
    expect(dockerStep(unhealthy)).toEqual(["opened warning sonarr: unhealthy"]);
    dockerStep(running);
    expect(dockerStep(running)).toEqual(["resolved warning sonarr: unhealthy"]);
  });

  it("tell an out-of-memory kill from a stop with the same exit code", () => {
    const stopped = container("exited", "Exited (137) 1 minute ago", 137);
    dockerStep(running);
    dockerStep(stopped);
    expect(dockerStep(stopped)).toEqual([]); // docker stop after the timeout
    dockerStep(running);
    const oom = { ...stopped, oomKilled: true };
    dockerStep(oom);
    expect(dockerStep(oom)).toEqual(["opened critical sonarr: killed (out of memory)"]);
    dockerStep(running);
    dockerStep(running);
  });

  it("warn about a crash loop while the container looks running", () => {
    const fresh = container("running", "Up 40 seconds");
    expect(dockerStep(fresh, 0)).toEqual([]);
    expect(dockerStep(fresh, 2)).toEqual([]);
    expect(dockerStep(fresh, 3)).toEqual(["opened warning sonarr: crash loop"]);
    expect(find("docker:sonarr:crash-loop")?.message).toBe("Restarted 3 times in the last 15 minutes. Check its logs.");
    // Not inspected this round and up for less than the window: nothing known.
    expect(dockerStep(container("running", "Up 5 minutes"))).toEqual([]);
    expect(dockerStep(running, 1)).toEqual([]); // fewer restarts, but not quiet yet
    expect(dockerStep(running, 0)).toEqual(["resolved warning sonarr: crash loop"]);
  });

  it("close a crash loop alert after a SafeHub restart once the container is stable", () => {
    const fresh = container("running", "Up 40 seconds");
    dockerStep(fresh, 0);
    expect(dockerStep(fresh, 3)).toEqual(["opened warning sonarr: crash loop"]);
    // SafeHub restarted: empty restart history, the container is not inspected.
    expect(dockerStep(container("running", "Up 10 minutes"))).toEqual([]);
    expect(find("docker:sonarr:crash-loop")?.endedAt).toBeNull();
    expect(dockerStep(container("running", "Up 16 minutes"))).toEqual(["resolved warning sonarr: crash loop"]);
    // Also when it was stopped on purpose.
    dockerStep(fresh, 0);
    expect(dockerStep(fresh, 3)).toEqual(["opened warning sonarr: crash loop"]);
    expect(dockerStep(container("exited", "Exited (0) 1 second ago", 0))).toEqual(["resolved warning sonarr: crash loop"]);
  });

  it("ignore a container that was never seen running", () => {
    const other = { ...crashed, name: "old-thing" };
    dockerStep(other);
    dockerStep(other);
    expect(dockerStep(other)).toEqual([]);
  });
});

describe("qBittorrent port forwarding", () => {
  const mismatch = { forwardedPort: 51413, listenPort: 6881 };
  function portStep(portForward: Snapshot["portForward"]) {
    const readings: Reading[] =
      portForward?.status === "ok" ? [{ series: "qbittorrent:port-forward", value: portForward.mismatch ? 0 : 1, kind: "flag", label: "qBittorrent" }] : [];
    metrics.saveSamples(clock, readings.map(({ series, value }) => ({ series, value })));
    const events = rules.evaluateAlerts({ readings, disks: [], reachable: new Set<Source>(), portForward }, new Date(clock));
    clock += MINUTE;
    return events.map((item) => `${item.type} ${item.severity} ${item.title}`);
  }

  it("warn after 3 mismatching samples, keep without data, close after 2 good ones", () => {
    expect(portStep({ status: "ok", mismatch })).toEqual([]);
    expect(portStep({ status: "ok", mismatch })).toEqual([]);
    expect(portStep({ status: "ok", mismatch })).toEqual(["opened warning qBittorrent listens on 6881, VPN forwards 51413"]);
    expect(portStep(undefined)).toEqual([]); // check failed this round
    expect(portStep({ status: "ok", mismatch: null })).toEqual([]);
    expect(portStep({ status: "ok", mismatch: null })).toEqual(["resolved warning qBittorrent listens on 6881, VPN forwards 51413"]);
  });

  it("close when qBittorrent or Gluetun is removed from the settings", () => {
    for (let minute = 0; minute < 3; minute++) portStep({ status: "ok", mismatch });
    expect(find("qbittorrent:port-mismatch")?.endedAt).toBeNull();
    expect(portStep({ status: "not-configured" })).toEqual(["resolved warning qBittorrent listens on 6881, VPN forwards 51413"]);
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
