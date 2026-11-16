import "server-only";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alert, type Alert } from "@/db/schema";
import type { Snapshot, Source } from "@/lib/metrics/collect";
import { series } from "@/lib/metrics/series";
import { hasValue, lastValues } from "@/lib/metrics/store";
import { failureAlert } from "./failure";

// Built-in alert rules, checked after every sample. Each rule opens an alert
// when its condition holds and closes it once the value is clearly back to
// normal (the gap between open and close stops flickering).
export const thresholds = {
  usage: { open: 90, close: 85, minutes: 5 }, // CPU / RAM, sustained
  volume: { warning: 85, critical: 95, close: 83 },
  // Restarts by the restart policy within 15 minutes (see collect.ts).
  crashLoop: { restarts: 3 },
  // Samples in a row before qBittorrent's port vs the VPN's forwarded port
  // alerts (Gluetun can take a moment to apply a new port).
  portMismatch: { minutes: 3 },
};

// DSM disk and volume states. Only clearly bad ones alert: new, unused or
// not yet initialized disks ("not_initialized", "initialized", "not_use")
// and busy volumes ("data_scrubbing", "expanding" ...) are fine. Matched as
// parts of the name, since DSM versions spell them differently
// ("system_partition_failed", "degrade", "degraded"). A disk DSM only warns
// about (SMART warning, "abnormal") is a warning, a failing one critical.
const CRITICAL_DISK = /crash|fail|degrad|critical|damage|broken/i;
const WARNING_DISK = /attention|warning|abnormal/i;
const CRITICAL_VOLUME = /crash|fail|degrad|damage|broken/i;
const WARNING_VOLUME = /attention|warning|abnormal|read_?only/i;

export function diskSeverity(status: string): Severity | null {
  if (CRITICAL_DISK.test(status)) return "critical";
  if (WARNING_DISK.test(status)) return "warning";
  return null;
}

export function volumeSeverity(status: string): Severity | null {
  if (CRITICAL_VOLUME.test(status)) return "critical";
  if (WARNING_VOLUME.test(status)) return "warning";
  return null;
}

type Severity = Alert["severity"];

// What changed in one round, for notifications.
export type AlertEvent = {
  type: "opened" | "escalated" | "resolved";
  key: string;
  // Notifications for this alert are muted until then (null: not muted).
  mutedUntil: Date | null;
  severity: Severity;
  title: string;
  message: string;
  startedAt: Date;
};
type Verdict =
  | { state: "open"; severity: Severity; title: string; message: string; value?: number; unit: string }
  | { state: "close" }
  | { state: "keep" }; // in between: an open alert stays open, none is opened

const round = (value: number) => Math.round(value);

function usageVerdict(seriesName: string, value: number, title: string, now: number): Verdict {
  const { open, close, minutes } = thresholds.usage;
  const recent = lastValues(seriesName, minutes, now);
  if (recent.length === minutes && recent.every((sample) => sample >= open)) {
    return { state: "open", severity: "warning", title, message: `Above ${open}% for ${minutes} minutes.`, value, unit: "%" };
  }
  return value < close ? { state: "close" } : { state: "keep" };
}

export function evaluateAlerts(snapshot: Snapshot, now: Date): AlertEvent[] {
  const open = new Map(
    db.select().from(alert).where(isNull(alert.endedAt)).all().map((row) => [row.key, row] as const),
  );
  const seen = new Set<string>();
  const events: AlertEvent[] = [];

  function resolve(existing: Alert) {
    db.update(alert).set({ endedAt: now }).where(eq(alert.id, existing.id)).run();
    events.push({
      type: "resolved",
      key: existing.key,
      mutedUntil: existing.mutedUntil,
      severity: existing.severity,
      title: existing.title,
      message: existing.message,
      startedAt: existing.startedAt,
    });
  }

  function apply(key: string, verdict: Verdict) {
    seen.add(key);
    const existing = open.get(key);
    if (verdict.state === "close") {
      if (existing) resolve(existing);
      return;
    }
    if (verdict.state === "keep") return;
    if (!existing) {
      db.insert(alert)
        .values({
          key,
          severity: verdict.severity,
          title: verdict.title,
          message: verdict.message,
          unit: verdict.unit,
          peak: verdict.value,
          startedAt: now,
        })
        .run();
      events.push({ type: "opened", key, mutedUntil: null, severity: verdict.severity, title: verdict.title, message: verdict.message, startedAt: now });
      return;
    }
    // Still a problem: keep the peak, escalate to critical, refresh the text.
    // An escalation counts as news, so it shows as unread again.
    const escalated = existing.severity === "warning" && verdict.severity === "critical";
    db.update(alert)
      .set({
        severity: escalated ? "critical" : existing.severity,
        message: verdict.message,
        title: verdict.title,
        peak: verdict.value === undefined ? existing.peak : Math.max(existing.peak ?? verdict.value, verdict.value),
        ...(escalated ? { readAt: null } : {}),
      })
      .where(eq(alert.id, existing.id))
      .run();
    if (escalated) {
      events.push({
        type: "escalated",
        key,
        mutedUntil: existing.mutedUntil,
        severity: "critical",
        title: verdict.title,
        message: verdict.message,
        startedAt: existing.startedAt,
      });
    }
  }

  for (const reading of snapshot.readings) {
    const { series: name, value, label } = reading;
    if (reading.kind === "cpu") apply(name, usageVerdict(name, value, `${label}: CPU high`, now.getTime()));
    if (reading.kind === "ram") apply(name, usageVerdict(name, value, `${label}: memory high`, now.getTime()));
    if (reading.kind === "volume") {
      const { warning, critical, close } = thresholds.volume;
      apply(
        name,
        value >= warning
          ? {
              state: "open",
              severity: value >= critical ? "critical" : "warning",
              title: `${label}: almost full`,
              message: `${round(value)}% used.`,
              value,
              unit: "%",
            }
          : value < close
            ? { state: "close" }
            : { state: "keep" },
      );
    }
    if (reading.kind === "up") {
      const grace = reading.graceMinutes ?? 3;
      const recent = lastValues(name, grace, now.getTime());
      const down = recent.length === grace && recent.every((sample) => sample === 0);
      // Close only after two good samples in a row, so a flapping service
      // does not open and close (and notify) every few minutes.
      const lastTwo = lastValues(name, 2, now.getTime());
      const back = lastTwo.length === 2 && lastTwo.every((sample) => sample === 1);
      // The title names the cause of the latest failure (login rejected,
      // certificate changed ...); the key stays the series name.
      apply(
        name,
        down
          ? { state: "open", severity: "critical", ...failureAlert(label, grace, reading.failure), unit: "" }
          : back
            ? { state: "close" }
            : { state: "keep" },
      );
    }
  }

  for (const backup of snapshot.backups ?? []) {
    apply(
      backup.key,
      backup.ageDays > backup.maxAgeDays
        ? {
            state: "open",
            severity: "warning",
            title: `${backup.label}: backup overdue`,
            message: `Newest backup is ${Math.floor(backup.ageDays)} days old (limit ${backup.maxAgeDays}).`,
            unit: "",
          }
        : { state: "close" },
    );
  }

  for (const job of snapshot.backupJobs ?? []) {
    apply(
      job.key,
      job.ok
        ? { state: "close" }
        : {
            state: "open",
            severity: "warning",
            title: `Backup job failed on ${job.node}`,
            message: `Proxmox reports: ${job.status}. See Datacenter > Backup and the task log.`,
            unit: "",
          },
    );
  }

  for (const disk of snapshot.disks) {
    const severity = diskSeverity(disk.status);
    apply(
      disk.key,
      severity
        ? {
            state: "open",
            severity,
            title: `${disk.label}: ${disk.status}`,
            message: "Check the disk in DSM > Storage Manager.",
            unit: "",
          }
        : { state: "close" },
    );
  }

  for (const volume of snapshot.volumes ?? []) {
    const severity = volumeSeverity(volume.status);
    apply(
      volume.key,
      severity
        ? {
            state: "open",
            severity,
            title: `${volume.label}: ${volume.status.replaceAll("_", " ")}`,
            message:
              severity === "critical"
                ? "The storage pool lost redundancy or failed. Check DSM > Storage Manager before another disk fails."
                : "DSM reports a problem with this volume. Check DSM > Storage Manager.",
            unit: "",
          }
        : { state: "close" },
    );
  }

  // Docker containers. Only containers SafeHub has seen running (in the kept
  // history) alert, so long-dead leftovers do not; a container stopped on
  // purpose closes its alert.
  const t = now.getTime();
  for (const container of snapshot.containers ?? []) {
    const upSeries = series.dockerUp(container.name);
    const downKey = `docker:${container.name}:down`;
    if (container.crashed) {
      const recent = lastValues(upSeries, 2, t);
      // hasValue scans the series: only ask before opening, not while open.
      const down =
        recent.length === 2 && recent.every((sample) => sample === 0) && (open.has(downKey) || hasValue(upSeries, 1));
      apply(
        downKey,
        down
          ? {
              state: "open",
              severity: "critical",
              title:
                container.state === "restarting"
                  ? `${container.name}: keeps restarting`
                  : container.oomKilled
                    ? `${container.name}: killed (out of memory)`
                    : container.exitCode !== undefined
                    ? `${container.name}: stopped (exit code ${container.exitCode})`
                    : `${container.name}: stopped`,
              message: container.status || container.state,
              unit: "",
            }
          : { state: "keep" },
      );
    } else if (container.running) {
      const recent = lastValues(upSeries, 2, t);
      apply(downKey, recent.length === 2 && recent.every((sample) => sample === 1) ? { state: "close" } : { state: "keep" });
    } else {
      apply(downKey, { state: "close" });
    }

    // Crash loop: the restart policy keeps restarting it. A container that
    // crashes after half a minute is "running" in most samples, so the
    // restart count tells, not the state. Unknown (undefined) only while it
    // could have restarted within the window (see containerReadings), so an
    // alert left open over a SafeHub restart still closes.
    const loopKey = `docker:${container.name}:crash-loop`;
    if (container.recentRestarts !== undefined) {
      const restarts = container.recentRestarts;
      apply(
        loopKey,
        restarts >= thresholds.crashLoop.restarts
          ? {
              state: "open",
              severity: "warning",
              title: `${container.name}: crash loop`,
              message: `Restarted ${restarts} times in the last 15 minutes. Check its logs.`,
              unit: "",
            }
          : restarts === 0
            ? { state: "close" }
            : { state: "keep" },
      );
    } else if (open.has(loopKey)) {
      seen.add(loopKey); // nothing known about it this round
    }

    const healthSeries = series.dockerHealth(container.name);
    const healthKey = `docker:${container.name}:unhealthy`;
    if (container.running) {
      const recent = lastValues(healthSeries, 3, t);
      apply(
        healthKey,
        recent.length === 3 && recent.every((sample) => sample === 0)
          ? { state: "open", severity: "warning", title: `${container.name}: unhealthy`, message: container.status, unit: "" }
          : recent.slice(0, 2).length === 2 && recent.slice(0, 2).every((sample) => sample === 1)
            ? { state: "close" }
            : { state: "keep" },
      );
    } else {
      apply(healthKey, { state: "close" });
    }
  }

  // qBittorrent must listen on the port Gluetun forwards, or peers cannot
  // connect (downloads slow, no seeding). Closes after two good samples, or
  // when qBittorrent or Gluetun is removed from the settings.
  const portKey = "qbittorrent:port-mismatch";
  if (snapshot.portForward?.status === "not-configured") {
    apply(portKey, { state: "close" });
  } else if (snapshot.portForward?.status === "ok") {
    const { minutes } = thresholds.portMismatch;
    const recent = lastValues(series.portForward, minutes, t);
    const mismatch = snapshot.portForward.mismatch;
    apply(
      portKey,
      mismatch && recent.length === minutes && recent.every((sample) => sample === 0)
        ? {
            state: "open",
            severity: "warning",
            title: `qBittorrent listens on ${mismatch.listenPort}, VPN forwards ${mismatch.forwardedPort}`,
            message: `Set qBittorrent's listening port to ${mismatch.forwardedPort} (Options > Connection), or let Gluetun update it automatically.`,
            unit: "",
          }
        : recent.slice(0, 2).length === 2 && recent.slice(0, 2).every((sample) => sample === 1)
          ? { state: "close" }
          : { state: "keep" },
    );
  }

  // Alerts whose subject disappeared while its system answered (a guest was
  // stopped, a volume removed) are over. If the system itself is down its
  // "unreachable" alert covers it, so leave the rest open.
  for (const [key, existing] of open) {
    if (seen.has(key)) continue;
    const source: Source | undefined =
      key.startsWith("synology:") || key.startsWith("disk:synology:") || key.startsWith("volume:synology:")
      ? "synology"
      : key.startsWith("node:") || key.startsWith("guest:") || key.startsWith("backup:") || key.startsWith("backup-job:")
        ? "proxmox"
        : key.startsWith("docker:")
          ? "docker"
          : undefined;
    // A part of the round that failed outright tells nothing: keep its alerts.
    const part = source ?? (key.startsWith("service:") ? "services" : undefined);
    if (part && snapshot.failed?.has(part)) continue;
    // Synology / Proxmox removed from the settings: all of its alerts are over.
    if (source && snapshot.configured && !snapshot.configured.has(source)) {
      resolve(existing);
      continue;
    }
    // Without backup data this round (storage slow, no permission) nothing is
    // known about backups: keep their alerts rather than close and reopen them.
    if ((key.startsWith("backup:") || key.startsWith("backup-job:")) && !snapshot.backups) continue;
    // Services and the Synology / Proxmox connections are checked every
    // minute while configured, so a missing reading means it was removed
    // from the settings: nothing left to alert about.
    if (key.startsWith("service:") || key === "synology:up" || key === "proxmox:up") {
      resolve(existing);
      continue;
    }
    if (source && snapshot.reachable.has(source)) {
      resolve(existing);
    }
  }
  return events;
}
