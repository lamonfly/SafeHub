import "server-only";
import { eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { alert, type Alert } from "@/db/schema";
import type { Snapshot, Source } from "@/lib/metrics/collect";
import { lastValues } from "@/lib/metrics/store";

// Built-in alert rules, checked after every sample. Each rule opens an alert
// when its condition holds and closes it once the value is clearly back to
// normal (the gap between open and close stops flickering).
export const thresholds = {
  usage: { open: 90, close: 85, minutes: 5 }, // CPU / RAM, sustained
  volume: { warning: 85, critical: 95, close: 83 },
};

type Severity = Alert["severity"];

// What changed in one round, for notifications.
export type AlertEvent = {
  type: "opened" | "escalated" | "resolved";
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
    events.push({ type: "resolved", severity: existing.severity, title: existing.title, message: existing.message, startedAt: existing.startedAt });
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
      events.push({ type: "opened", severity: verdict.severity, title: verdict.title, message: verdict.message, startedAt: now });
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
      events.push({ type: "escalated", severity: "critical", title: verdict.title, message: verdict.message, startedAt: existing.startedAt });
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
      apply(
        name,
        down
          ? { state: "open", severity: "critical", title: `${label}: unreachable`, message: `No answer for ${grace}+ minutes.`, unit: "" }
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
    apply(
      disk.key,
      disk.status === "normal"
        ? { state: "close" }
        : {
            state: "open",
            severity: "critical",
            title: `${disk.label}: ${disk.status}`,
            message: "Check the disk in DSM > Storage Manager.",
            unit: "",
          },
    );
  }

  // Alerts whose subject disappeared while its system answered (a guest was
  // stopped, a volume removed) are over. If the system itself is down its
  // "unreachable" alert covers it, so leave the rest open.
  for (const [key, existing] of open) {
    if (seen.has(key)) continue;
    const source: Source | undefined = key.startsWith("synology:") || key.startsWith("disk:synology:")
      ? "synology"
      : key.startsWith("node:") || key.startsWith("guest:") || key.startsWith("backup:") || key.startsWith("backup-job:")
        ? "proxmox"
        : undefined;
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
